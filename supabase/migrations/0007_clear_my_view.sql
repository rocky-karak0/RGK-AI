-- RGK 0007: clear-on-exit now clears ONLY the exiting user's own view.
-- Run AFTER 0006_clear_on_exit.sql.
--
-- Before (0006): chat_clear destroyed messages for EVERYONE — the other
-- member watched the conversation vanish from their screen too.
-- Now (0007): chat_clear only stamps MY conversation_members.cleared_at.
--   - my copy of the chat history disappears (queries filter created_at > cleared_at)
--   - the other member is completely untouched: no message rows change, no
--     realtime events, no storage deletion (they still need attachments)
-- The "every message already read by all" guard (0006) stays: unread chats
-- are never cleared by an exit, so nothing is lost before it is seen.

alter table public.conversation_members add column cleared_at timestamptz;

create or replace function public.chat_clear(cid uuid) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 0; end if;
  if not is_member(cid) then return 0; end if;
  -- keep everything while ANY message is unread by ANY non-sender member
  if exists (select 1 from messages m where m.conversation_id = cid and m.deleted_at is null
             and not exists (select 1 from conversation_members cm where cm.conversation_id = cid
                             and (cm.user_id = m.sender_id or cm.last_read_at >= m.created_at))) then
    return 0;
  end if;
  update conversation_members set cleared_at = now()
   where conversation_id = cid and user_id = auth.uid();
  return 1;
end $$;

-- drop first: adding the my_cleared_at result column changes the return type
drop function if exists public.my_conversations();
create function public.my_conversations() returns table (
  id uuid, kind text, title text, description text, last_body text, last_kind text,
  last_at timestamptz, unread bigint, other_id uuid, my_role text, my_cleared_at timestamptz)
language sql security definer stable set search_path = public as $$
  select c.id, c.kind, c.title, c.description, lm.body, lm.kind, lm.created_at,
    (select count(*) from messages m where m.conversation_id = c.id and m.sender_id <> auth.uid()
        and m.deleted_at is null and m.created_at > cm.last_read_at),
    (select o.user_id from conversation_members o where o.conversation_id = c.id and o.user_id <> auth.uid() and c.kind = 'direct' limit 1),
    cm.role, cm.cleared_at
  from conversation_members cm
  join conversations c on c.id = cm.conversation_id
  left join lateral (select m.body, m.kind, m.created_at from messages m
                     where m.conversation_id = c.id and m.deleted_at is null
                       and m.created_at > coalesce(cm.cleared_at, '-infinity'::timestamptz)
                     order by m.created_at desc limit 1) lm on true
  where cm.user_id = auth.uid()
  order by coalesce(lm.created_at, c.created_at) desc
$$;

grant execute on function public.chat_clear(uuid), public.my_conversations() to anon, authenticated, service_role;
