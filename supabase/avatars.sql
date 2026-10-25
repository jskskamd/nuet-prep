-- NUET.exe profile photos: run this once in Supabase (SQL Editor -> New query -> paste -> Run),
-- after forum.sql and accounts.sql.
-- Anyone can see the photos (they show next to forum posts); each student can only upload,
-- replace and delete their own, stored as <account id>.jpg. The app shrinks photos to
-- 256x256 JPEGs, so the size limit is generous.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 200000, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Uploading with "replace if it exists" needs select, insert and update.
drop policy if exists "Students read their own photo" on storage.objects;
create policy "Students read their own photo" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');

drop policy if exists "Students upload their own photo" on storage.objects;
create policy "Students upload their own photo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg'
              and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);

drop policy if exists "Students replace their own photo" on storage.objects;
create policy "Students replace their own photo" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg')
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');

drop policy if exists "Students delete their own photo" on storage.objects;
create policy "Students delete their own photo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');
