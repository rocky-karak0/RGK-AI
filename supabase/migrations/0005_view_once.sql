-- RGK 0005: view-once messages (Snapchat style).
-- Run AFTER 0004_viewers_purge.sql.
--
-- A message sent with view_once = true is permanently destroyed for EVERYONE
-- (body nulled via deleted_at, attachment object removed) the first time a
-- non-sender member has it visibly rendered on screen. The sender may still
-- soft-delete their own messages as before; clients cannot flip view_once
-- after insert (messages UPDATE is column-restricted to body/edited_at/deleted_at).

alter table public.messages add column view_once boolean not null default false;

-- destroy a view-once message on first view. Idempotent (deleted_at guard);
-- only the recipient side may trigger it, never the sender.
create function public.mark_view_once_seen(mid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare path text;
begin
  if auth.uid() is null then return; end if;
  update messages set deleted_at = now()
   where id = mid
     and view_once
     and deleted_at is null
     and sender_id <> auth.uid()
     and is_member(conversation_id)
   returning storage_path into path;
  if path is not null then
    begin
      delete from storage.objects where bucket_id = 'attachments' and name = path;
    exception when others then
      null; -- best effort: the row is gone, so signed URLs stop being issued
    end;
  end if;
end $$;

-- sidebar previews must not leak view-once content before it is seen.
create or replace function public.my_conversations() returns table (
  id uuid, kind text, title text, description text, last_body text, last_kind text,
  last_at timestamptz, unread bigint, other_id uuid, my_role text)
language sql security definer stable set search_path = public as $$
  select c.id, c.kind, c.title, c.description,
    case when lm.view_once then '[View-once message]' else lm.body end,
    lm.kind, lm.created_at,
    (select count(*) from messages m where m.conversation_id = c.id and m.sender_id <> auth.uid()
        and m.deleted_at is null and m.created_at > cm.last_read_at),
    (select o.user_id from conversation_members o where o.conversation_id = c.id and o.user_id <> auth.uid() and c.kind = 'direct' limit 1),
    cm.role
  from conversation_members cm
  join conversations c on c.id = cm.conversation_id
  left join lateral (select m.body, m.kind, m.created_at, m.view_once from messages m
                     where m.conversation_id = c.id and m.deleted_at is null order by m.created_at desc limit 1) lm on true
  where cm.user_id = auth.uid()
  order by coalesce(lm.created_at, c.created_at) desc
$$;

grant execute on function public.mark_view_once_seen(uuid) to anon, authenticated, service_role;
