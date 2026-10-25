-- NUET.exe forum: run this once in Supabase (SQL Editor -> New query -> paste -> Run).
-- Everyone can read; each student signs in anonymously from the app and can only
-- post as themselves and delete their own posts.

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_id uuid not null default auth.uid() references auth.users on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 40),
  section text not null check (section in ('math', 'ctps')),
  tag text check (tag is null or char_length(tag) <= 60), -- tagged question, e.g. 'nsaa-2016:5'
  title text not null check (char_length(title) between 3 and 150),
  body text not null default '' check (char_length(body) <= 3000)
);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  thread_id uuid not null references public.threads on delete cascade,
  author_id uuid not null default auth.uid() references auth.users on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 40),
  body text not null check (char_length(body) between 1 and 3000)
);

create index threads_created_at on public.threads (created_at desc);
create index threads_tag on public.threads (tag);
create index answers_thread on public.answers (thread_id, created_at);

alter table public.threads enable row level security;
alter table public.answers enable row level security;

create policy "Anyone can read threads" on public.threads
  for select using (true);
create policy "Students post threads as themselves" on public.threads
  for insert to authenticated with check (author_id = auth.uid());
create policy "Authors delete their own threads" on public.threads
  for delete to authenticated using (author_id = auth.uid());

create policy "Anyone can read answers" on public.answers
  for select using (true);
create policy "Students post answers as themselves" on public.answers
  for insert to authenticated with check (author_id = auth.uid());
create policy "Authors delete their own answers" on public.answers
  for delete to authenticated using (author_id = auth.uid());
