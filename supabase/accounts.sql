-- NUET.exe accounts: run this once in Supabase (SQL Editor -> New query -> paste -> Run),
-- after forum.sql.

-- Lets a signed-in student delete their own account from the app. Their forum questions
-- and answers are deleted with it (the forum tables cascade on the account).
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Posting needs a real (email) account, even if anonymous sign-ins get switched on later.
drop policy if exists "Students post threads as themselves" on public.threads;
create policy "Students post threads as themselves" on public.threads
  for insert to authenticated
  with check (author_id = auth.uid() and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);

drop policy if exists "Students post answers as themselves" on public.answers;
create policy "Students post answers as themselves" on public.answers
  for insert to authenticated
  with check (author_id = auth.uid() and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
