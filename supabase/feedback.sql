-- NUET.exe feedback ("Is this app useful for you?"): run this once in Supabase
-- (SQL Editor -> New query -> paste -> Run).
-- Anyone using the app can send an answer; nobody can read them through the app.
-- Read them in Supabase: Table Editor -> feedback.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  answer text not null check (answer in ('yes', 'somewhat', 'no')),
  comment text not null default '' check (char_length(comment) <= 1000),
  tg_user_id bigint, -- the Telegram user who answered, when the app was opened in Telegram
  name text check (name is null or char_length(name) <= 80)
);

alter table public.feedback enable row level security;

drop policy if exists "Anyone can send feedback" on public.feedback;
create policy "Anyone can send feedback" on public.feedback
  for insert to anon, authenticated with check (true);
