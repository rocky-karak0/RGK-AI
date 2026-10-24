-- RGK 0006: rollback view-once (0005) + Snapchat-style clear-on-exit.
-- Run AFTER 0005_view_once.sql.
--
-- 1) 0005 (view-once) is withdrawn: drop its column + RPC and restore the
--    original my_conversations previews (no more '[View-once message]' scrub).
-- 2) chat_clear(cid): when a member LEAVES a conversation (back button,
--    switching chats, or leaving the page), every message in it is destroyed
--    for EVERYONE — but only if every member has already read every message
--    (each message: read by all members except its sender). Unread chats are
--    kept untouched until the reader leaves too. Groups included; attachments
--    are removed from storage best-effort. Idempotent (deleted_at guard).

-- ---------- rollback of 0005_view_once.sql ----------

drop function if exists public.mark_view_once_seen(uuid);
alter table public.messages drop column if exists view_once;

-- original definition (0002_features.sql) — no view-once placeholder
create or replace function public.my_conversations() returns table (
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

-- ---------- clear-on-exit ----------

create function public.chat_clear(cid uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  if auth.uid() is null then return 0; end if;
  if not is_member(cid) then return 0; end if;
  -- keep everything while ANY message is unread by ANY non-sender member
  -- (same rule as try_purge guard 4 in 0004_viewers_purge.sql)
  if exists (select 1 from messages m where m.conversation_id = cid and m.deleted_at is null
             and not exists (select 1 from conversation_members cm where cm.conversation_id = cid
                             and (cm.user_id = m.sender_id or cm.last_read_at >= m.created_at))) then
    return 0;
  end if;
  begin
    delete from storage.objects where bucket_id = 'attachments'
      and name in (select storage_path from messages
                    where conversation_id = cid and deleted_at is null and storage_path is not null);
  exception when others then
    null; -- best effort: rows get deleted_at, so signed URLs stop being issued
  end;
  update messages set deleted_at = now() where conversation_id = cid and deleted_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.chat_clear(uuid) to anon, authenticated, service_role;
