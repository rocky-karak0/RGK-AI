-- RGK 0002: settings, blocks, reactions, receipts, groups, calls, storage, push, admin, hardening.
-- Run AFTER 0001_core.sql.

alter table public.profiles
  add column if not exists is_admin boolean not null default false,
  add column if not exists suspended_at timestamptz;
alter table public.conversations
  add column if not exists description text,
  add column if not exists avatar_url text;
alter table public.conversation_members
  add column if not exists last_read_at timestamptz not null default now();
alter table public.messages
  add column if not exists storage_path text,
  add column if not exists file_name text,
  add column if not exists file_size bigint,
  add column if not exists mime_type text,
  add column if not exists duration_ms integer;

-- ---------- tables ----------
create table public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  show_online boolean not null default true,
  show_last_seen boolean not null default true,
  send_read_receipts boolean not null default true,
  notify_messages boolean not null default true,
  notify_groups boolean not null default true,
  notify_calls boolean not null default true,
  sound boolean not null default true,
  theme text not null default 'dark' check (theme in ('dark','light','system'))
);
create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id), check (blocker_id <> blocked_id)
);
create table public.contacts (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, contact_id), check (owner_id <> contact_id)
);
create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  reason text not null check (char_length(reason) between 3 and 1000),
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now()
);
create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create table public.message_read_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create table public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('audio','video')),
  status text not null default 'ringing' check (status in ('ringing','active','ended','missed','rejected')),
  created_at timestamptz not null default now(),
  answered_at timestamptz, ended_at timestamptz
);
create index on public.call_sessions (callee_id, created_at desc);
create index on public.call_sessions (caller_id, created_at desc);
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique, p256dh text not null, auth text not null,
  created_at timestamptz not null default now()
);
create index on public.message_reactions (message_id);
create index on public.message_read_receipts (message_id);

-- ---------- helper functions ----------
create function public.is_admin() returns boolean language sql security definer stable set search_path = public as
$$ select coalesce((select is_admin from profiles where id = auth.uid()), false) $$;
create function public.can_act() returns boolean language sql security definer stable set search_path = public as
$$ select auth.uid() is not null and not exists (select 1 from profiles where id = auth.uid() and suspended_at is not null) $$;
create function public.is_group_admin(cid uuid) returns boolean language sql security definer stable set search_path = public as
$$ select exists (select 1 from conversation_members where conversation_id = cid and user_id = auth.uid() and role = 'admin') $$;
create function public.is_blocked_between(a uuid, b uuid) returns boolean language sql security definer stable set search_path = public as
$$ select exists (select 1 from user_blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)) $$;
create function public.direct_blocked(cid uuid) returns boolean language sql security definer stable set search_path = public as
$$ select exists (select 1 from conversations c join conversation_members o on o.conversation_id = c.id and o.user_id <> auth.uid()
                  where c.id = cid and c.kind = 'direct' and public.is_blocked_between(auth.uid(), o.user_id)) $$;

create function public.can_use_topic(t text) returns boolean language plpgsql security definer stable set search_path = public as $$
begin
  if t like 'call:%' then
    return exists (select 1 from call_sessions c where c.id::text = substring(t from 6) and auth.uid() in (c.caller_id, c.callee_id));
  elsif t like 'typing:%' then
    return is_member(substring(t from 8)::uuid);
  end if;
  return false;
exception when others then return false;
end $$;

create function public.handle_new_profile() returns trigger language plpgsql security definer set search_path = public as
$$ begin insert into user_settings (user_id) values (new.id) on conflict do nothing; return new; end $$;
create trigger on_profile_created after insert on public.profiles for each row execute function public.handle_new_profile();
insert into public.user_settings (user_id) select id from public.profiles on conflict do nothing;

-- ---------- RPCs ----------
create or replace function public.create_direct_conversation(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; me uuid := auth.uid();
begin
  if me is null or other = me or not can_act() then raise exception 'invalid'; end if;
  if is_blocked_between(me, other) then raise exception 'blocked'; end if;
  select c.id into cid from conversations c where c.kind = 'direct'
    and exists (select 1 from conversation_members where conversation_id = c.id and user_id = me)
    and exists (select 1 from conversation_members where conversation_id = c.id and user_id = other);
  if cid is not null then return cid; end if;
  insert into conversations (kind, created_by) values ('direct', me) returning id into cid;
  insert into conversation_members (conversation_id, user_id) values (cid, me), (cid, other);
  return cid;
end $$;

create function public.create_group(p_title text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; me uuid := auth.uid(); u uuid;
begin
  if not can_act() or char_length(trim(coalesce(p_title, ''))) = 0 then raise exception 'invalid'; end if;
  insert into conversations (kind, title, created_by) values ('group', trim(p_title), me) returning id into cid;
  insert into conversation_members (conversation_id, user_id, role) values (cid, me, 'admin');
  foreach u in array coalesce(p_members, '{}') loop
    if u <> me and not is_blocked_between(me, u) then
      insert into conversation_members (conversation_id, user_id) values (cid, u) on conflict do nothing;
    end if;
  end loop;
  return cid;
end $$;

create function public.add_group_member(cid uuid, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_act() or not is_group_admin(cid) or not exists (select 1 from conversations where id = cid and kind = 'group') then raise exception 'forbidden'; end if;
  if is_blocked_between(auth.uid(), uid) then raise exception 'blocked'; end if;
  insert into conversation_members (conversation_id, user_id) values (cid, uid) on conflict do nothing;
end $$;

create function public.remove_group_member(cid uuid, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_group_admin(cid) or uid = auth.uid() then raise exception 'forbidden'; end if;
  delete from conversation_members where conversation_id = cid and user_id = uid;
end $$;

create function public.set_group_admin(cid uuid, uid uuid, flag boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_group_admin(cid) then raise exception 'forbidden'; end if;
  update conversation_members set role = case when flag then 'admin' else 'member' end where conversation_id = cid and user_id = uid;
end $$;

create function public.leave_group(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(cid) then raise exception 'forbidden'; end if;
  delete from conversation_members where conversation_id = cid and user_id = auth.uid();
  if not exists (select 1 from conversation_members where conversation_id = cid) then
    delete from conversations where id = cid;
  elsif not exists (select 1 from conversation_members where conversation_id = cid and role = 'admin') then
    update conversation_members set role = 'admin'
     where (conversation_id, user_id) = (select conversation_id, user_id from conversation_members where conversation_id = cid order by joined_at limit 1);
  end if;
end $$;

create function public.my_conversations() returns table (
  id uuid, kind text, title text, description text, last_body text, last_kind text,
  last_at timestamptz, unread bigint, other_id uuid, my_role text)
language sql security definer stable set search_path = public as $$
  select c.id, c.kind, c.title, c.description, lm.body, lm.kind, lm.created_at,
    (select count(*) from messages m where m.conversation_id = c.id and m.sender_id <> auth.uid()
        and m.deleted_at is null and m.created_at > cm.last_read_at),
    (select o.user_id from conversation_members o where o.conversation_id = c.id and o.user_id <> auth.uid() and c.kind = 'direct' limit 1),
    cm.role
  from conversation_members cm
  join conversations c on c.id = cm.conversation_id
  left join lateral (select m.body, m.kind, m.created_at from messages m
                     where m.conversation_id = c.id and m.deleted_at is null order by m.created_at desc limit 1) lm on true
  where cm.user_id = auth.uid()
  order by coalesce(lm.created_at, c.created_at) desc
$$;

create function public.mark_conversation_read(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare since timestamptz;
begin
  if not is_member(cid) then raise exception 'forbidden'; end if;
  select last_read_at into since from conversation_members where conversation_id = cid and user_id = auth.uid();
  if coalesce((select send_read_receipts from user_settings where user_id = auth.uid()), true) then
    insert into message_read_receipts (message_id, user_id)
    select m.id, auth.uid() from messages m
     where m.conversation_id = cid and m.sender_id <> auth.uid() and m.created_at > since
    on conflict do nothing;
  end if;
  update conversation_members set last_read_at = now() where conversation_id = cid and user_id = auth.uid();
end $$;

create function public.get_presence(uids uuid[]) returns table (user_id uuid, online boolean, last_seen_at timestamptz)
language sql security definer stable set search_path = public as $$
  select p.user_id,
         coalesce(s.show_online, true) and p.last_seen_at > now() - interval '2 minutes',
         case when coalesce(s.show_last_seen, true) then p.last_seen_at end
  from user_presence p
  left join user_settings s on s.user_id = p.user_id
  where p.user_id = any (uids)
    and exists (select 1 from conversation_members a join conversation_members b on a.conversation_id = b.conversation_id
                where a.user_id = auth.uid() and b.user_id = p.user_id)
$$;

-- admin RPCs (server-side authorization; no private message content is exposed)
create function public.admin_stats() returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  return json_build_object('users', (select count(*) from profiles), 'conversations', (select count(*) from conversations),
    'messages', (select count(*) from messages), 'open_reports', (select count(*) from user_reports where status = 'open'),
    'suspended', (select count(*) from profiles where suspended_at is not null));
end $$;
create function public.admin_reports() returns table (id uuid, reporter text, reported_id uuid, reported text, reason text, status text, created_at timestamptz, suspended boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  return query select r.id, a.username, r.reported_id, b.username, r.reason, r.status, r.created_at, b.suspended_at is not null
    from user_reports r join profiles a on a.id = r.reporter_id join profiles b on b.id = r.reported_id order by r.created_at desc limit 100;
end $$;
create function public.admin_set_suspended(uid uuid, flag boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  update profiles set suspended_at = case when flag then now() else null end where id = uid and not is_admin;
end $$;
create function public.admin_resolve_report(rid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  update user_reports set status = 'resolved' where id = rid;
end $$;

-- ---------- column-level hardening ----------
revoke update on public.profiles from authenticated;
grant update (username, full_name, bio, avatar_url) on public.profiles to authenticated;
revoke update on public.messages from authenticated;
grant update (body, edited_at, deleted_at) on public.messages to authenticated;
revoke update on public.call_sessions from authenticated;
grant update (status, answered_at, ended_at) on public.call_sessions to authenticated;
revoke insert, update, delete on public.conversations from authenticated;
revoke insert, update, delete on public.conversation_members from authenticated;

-- ---------- RLS ----------
alter table public.user_settings enable row level security;
alter table public.user_blocks enable row level security;
alter table public.contacts enable row level security;
alter table public.user_reports enable row level security;
alter table public.message_reactions enable row level security;
alter table public.message_read_receipts enable row level security;
alter table public.user_presence enable row level security;
alter table public.call_sessions enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "own settings select" on public.user_settings for select to authenticated using (user_id = auth.uid());
create policy "own settings insert" on public.user_settings for insert to authenticated with check (user_id = auth.uid());
create policy "own settings update" on public.user_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own blocks select" on public.user_blocks for select to authenticated using (blocker_id = auth.uid());
create policy "own blocks insert" on public.user_blocks for insert to authenticated with check (blocker_id = auth.uid());
create policy "own blocks delete" on public.user_blocks for delete to authenticated using (blocker_id = auth.uid());

create policy "own contacts" on public.contacts for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "file report" on public.user_reports for insert to authenticated with check (reporter_id = auth.uid() and can_act());
create policy "read own reports" on public.user_reports for select to authenticated using (reporter_id = auth.uid());

create policy "members read reactions" on public.message_reactions for select to authenticated
  using (exists (select 1 from messages m where m.id = message_id and public.is_member(m.conversation_id)));
create policy "members react" on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_act() and exists (select 1 from messages m where m.id = message_id
              and public.is_member(m.conversation_id) and not public.direct_blocked(m.conversation_id)));
create policy "remove own reaction" on public.message_reactions for delete to authenticated using (user_id = auth.uid());

create policy "members read receipts" on public.message_read_receipts for select to authenticated
  using (exists (select 1 from messages m where m.id = message_id and public.is_member(m.conversation_id)));

create policy "own presence select" on public.user_presence for select to authenticated using (user_id = auth.uid());
create policy "own presence insert" on public.user_presence for insert to authenticated with check (user_id = auth.uid());
create policy "own presence update" on public.user_presence for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "participants read calls" on public.call_sessions for select to authenticated using (auth.uid() in (caller_id, callee_id));
create policy "start call" on public.call_sessions for insert to authenticated
  with check (caller_id = auth.uid() and public.can_act() and public.is_member(conversation_id)
    and exists (select 1 from conversations c where c.id = conversation_id and c.kind = 'direct')
    and exists (select 1 from conversation_members m where m.conversation_id = call_sessions.conversation_id and m.user_id = callee_id)
    and not public.is_blocked_between(caller_id, callee_id));
create policy "participants update calls" on public.call_sessions for update to authenticated
  using (auth.uid() in (caller_id, callee_id)) with check (auth.uid() in (caller_id, callee_id));

create policy "own push subs" on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- messages: block / suspension aware insert
drop policy "members send messages" on public.messages;
create policy "members send messages" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_act() and public.is_member(conversation_id)
    and not public.direct_blocked(conversation_id)
    and (storage_path is null or storage_path like conversation_id::text || '/%')
    and (reply_to is null or exists (select 1 from messages r where r.id = reply_to and r.conversation_id = messages.conversation_id)));

-- private channels: only call participants / conversation members can use signaling + typing topics
create policy "topic read" on realtime.messages for select to authenticated using (public.can_use_topic(realtime.topic()) and extension = 'broadcast');
create policy "topic write" on realtime.messages for insert to authenticated with check (public.can_use_topic(realtime.topic()) and extension = 'broadcast');

alter publication supabase_realtime add table public.message_reactions, public.message_read_receipts, public.call_sessions;

-- ---------- storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
 ('attachments', 'attachments', false, 26214400, array[
   'image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm',
   'audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/wav','application/pdf','text/plain','application/zip',
   'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
 ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "members read attachments" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "members upload attachments" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.can_act() and public.is_member(((storage.foldername(name))[1])::uuid)
              and not public.direct_blocked(((storage.foldername(name))[1])::uuid));
create policy "own avatar write" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own avatar update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own avatar delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
