-- RGK core schema: profiles, conversations, members, messages + RLS
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  full_name text not null default '',
  bio text not null default '' check (char_length(bio) <= 280),
  avatar_url text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct','group')),
  title text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member','admin')),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text','image','video','audio','file','voice')),
  body text check (char_length(body) <= 4000),
  reply_to uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique (conversation_id, sender_id, client_id)  -- prevents duplicates on reconnect
);
create index on public.messages (conversation_id, created_at desc);

-- SECURITY DEFINER avoids recursive RLS when policies check membership.
create function public.is_member(cid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from conversation_members where conversation_id = cid and user_id = auth.uid());
$$;

-- Auto-create profile on signup (username comes from signup metadata).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, username, full_name)
  values (new.id,
          lower(coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8))),
          coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Direct chats are created through this function (no client INSERT on conversations).
create function public.create_direct_conversation(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; me uuid := auth.uid();
begin
  if me is null or other = me then raise exception 'invalid'; end if;
  select c.id into cid from conversations c
   where c.kind = 'direct'
     and exists (select 1 from conversation_members where conversation_id = c.id and user_id = me)
     and exists (select 1 from conversation_members where conversation_id = c.id and user_id = other);
  if cid is not null then return cid; end if;
  insert into conversations (kind, created_by) values ('direct', me) returning id into cid;
  insert into conversation_members (conversation_id, user_id) values (cid, me), (cid, other);
  return cid;
end $$;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create policy "profiles readable by signed-in users" on public.profiles for select to authenticated using (true);
create policy "own profile update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "members read conversation" on public.conversations for select to authenticated using (public.is_member(id));
create policy "members read membership" on public.conversation_members for select to authenticated using (public.is_member(conversation_id));

create policy "members read messages" on public.messages for select to authenticated using (public.is_member(conversation_id));
create policy "members send messages" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(conversation_id));
create policy "sender edits own messages" on public.messages for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());

alter publication supabase_realtime add table public.messages;
