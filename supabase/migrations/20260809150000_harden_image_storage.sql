insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Avatar images are publicly accessible" on storage.objects;
drop policy if exists "Anyone can upload an avatar" on storage.objects;
drop policy if exists "Authenticated users can upload avatars" on storage.objects;
drop policy if exists "Users can update their own avatars" on storage.objects;
drop policy if exists "Users can delete their own avatars" on storage.objects;
drop policy if exists "Users can view their own product images" on storage.objects;
drop policy if exists "Users can upload their own product images" on storage.objects;
drop policy if exists "Users can update their own product images" on storage.objects;
drop policy if exists "Users can delete their own product images" on storage.objects;

create policy "Avatar images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Authenticated users can upload avatars"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update their own avatars"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete their own avatars"
  on storage.objects for delete
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can view their own product images"
  on storage.objects for select
  using (bucket_id = 'product-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can upload their own product images"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update their own product images"
  on storage.objects for update
  using (bucket_id = 'product-images' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'product-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete their own product images"
  on storage.objects for delete
  using (bucket_id = 'product-images' and auth.uid()::text = (storage.foldername(name))[1]);
