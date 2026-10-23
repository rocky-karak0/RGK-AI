-- RGK 0003: table/function grants for anon + authenticated.
-- New Supabase projects do not attach default privileges to tables created by
-- migrations, so 0001/0002 tables exist but return 42501 permission denied.
-- Run AFTER 0002_features.sql.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant all on tables to service_role;

grant execute on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- Re-apply 0002 column-level hardening (blanket grant above re-opened every column).
revoke update on public.profiles from authenticated;
grant update (username, full_name, bio, avatar_url) on public.profiles to authenticated;
revoke update on public.messages from authenticated;
grant update (body, edited_at, deleted_at) on public.messages to authenticated;
revoke update on public.call_sessions from authenticated;
grant update (status, answered_at, ended_at) on public.call_sessions to authenticated;
revoke insert, update, delete on public.conversations from authenticated;
revoke insert, update, delete on public.conversation_members from authenticated;
