-- RGK 0004: ephemeral direct chats — viewer heartbeats + purge RPCs.
-- Run AFTER 0003_grants.sql.
--
-- A DIRECT conversation is permanently deleted (conversation row, messages,
-- receipts, reactions, calls, membership + attachment objects) only when:
--   1. every member has opened it at least once (viewer row exists),
--   2. nobody beat in the last 15s (blocks the re-enter race / StrictMode double mount),
--   3. nobody still has it open (no viewing heartbeat newer than 4 minutes),
--   4. every message is read by all members except its sender,
--   5. no call is ringing/active.
-- Groups are never purged (they use leave_group instead).

create table public.conversation_viewers (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  viewing boolean not null default false,
  last_beat timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.conversation_viewers enable row level security;
create policy "own viewer row" on public.conversation_viewers for select to authenticated
  using (user_id = auth.uid());

-- reads are allowed for debugging; writes happen only through the definer RPCs below
grant select on public.conversation_viewers to authenticated;
revoke insert, update, delete on public.conversation_viewers from authenticated;

-- member entered the conversation; also the 15s heartbeat while it is open.
create function public.chat_view(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_member(cid) then return; end if;
  insert into conversation_viewers (conversation_id, user_id, viewing, last_beat)
  values (cid, auth.uid(), true, now())
  on conflict (conversation_id, user_id)
  do update set viewing = true, last_beat = excluded.last_beat;
end $$;

-- member left the conversation. Deletes nothing: chat_sweep does, once BOTH
-- members are out and everything is read (see guards in try_purge).
create function public.chat_unview(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_member(cid) then return; end if;
  insert into conversation_viewers (conversation_id, user_id, viewing, last_beat)
  values (cid, auth.uid(), false, now())
  on conflict (conversation_id, user_id)
  do update set viewing = false, last_beat = excluded.last_beat;
end $$;

-- delete one abandoned direct conversation everywhere. Returns true if purged.
create function public.try_purge(cid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if not exists (select 1 from conversation_members where conversation_id = cid and user_id = auth.uid()) then return false; end if;
  if not exists (select 1 from conversations c where c.id = cid and c.kind = 'direct') then return false; end if;
  -- guard 2: nobody beat in the last 15 seconds
  if exists (select 1 from conversation_viewers v
             where v.conversation_id = cid and v.last_beat > now() - interval '15 seconds') then return false; end if;
  -- guard 3: nobody still has it open (4 min tolerates background-tab timer throttling)
  if exists (select 1 from conversation_viewers v
             where v.conversation_id = cid and v.viewing and v.last_beat > now() - interval '4 minutes') then return false; end if;
  -- guard 1: every member has opened it at least once (protects never-seen chats)
  if exists (select 1 from conversation_members cm where cm.conversation_id = cid
             and not exists (select 1 from conversation_viewers v
                             where v.conversation_id = cid and v.user_id = cm.user_id)) then return false; end if;
  -- guard 4: every message read by all members except its sender (protects unread)
  if exists (select 1 from messages m where m.conversation_id = cid and m.deleted_at is null
             and not exists (select 1 from conversation_members cm where cm.conversation_id = cid
                             and (cm.user_id = m.sender_id or cm.last_read_at >= m.created_at))) then return false; end if;
  -- guard 5: never delete a conversation with a live call
  if exists (select 1 from call_sessions cs
             where cs.conversation_id = cid and cs.status in ('ringing', 'active')) then return false; end if;
  begin
    delete from storage.objects where bucket_id = 'attachments' and name like cid::text || '/%';
  exception when others then
    null; -- best effort: rows make signed URLs 404; orphaned blobs are unreachable
  end;
  delete from conversations where id = cid; -- cascades members/messages/receipts/reactions/calls/viewers
  return true;
end $$;

-- called on app load, on the 60s presence beat, and ~16s after a member leaves a chat.
create function public.chat_sweep() returns integer
language plpgsql security definer set search_path = public as $$
declare cid uuid; purged integer := 0;
begin
  if auth.uid() is null then return 0; end if;
  for cid in
    select c.id from conversations c
     where c.kind = 'direct'
       and exists (select 1 from conversation_members cm
                   where cm.conversation_id = c.id and cm.user_id = auth.uid())
       and not exists (select 1 from conversation_viewers v
                       where v.conversation_id = c.id and v.last_beat > now() - interval '15 seconds')
  loop
    if try_purge(cid) then purged := purged + 1; end if;
  end loop;
  return purged;
end $$;

grant execute on function public.chat_view(uuid), public.chat_unview(uuid),
  public.try_purge(uuid), public.chat_sweep() to anon, authenticated, service_role;

-- canary: prove the migration role may delete storage metadata (purge needs it).
do $$
begin
  delete from storage.objects where bucket_id = 'attachments' and name = '__rgk_canary__';
  raise notice 'rgk 0004 canary ok: storage.objects rows are deletable';
exception when others then
  raise warning 'rgk 0004 CANARY FAILED (%): attachment files will not be deleted on purge', sqlerrm;
end $$;
