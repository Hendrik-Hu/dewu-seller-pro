begin;

drop policy if exists "Allow All Access Activities" on public.activities;
drop policy if exists "Enable all access for own activities" on public.activities;
drop policy if exists "Users can view their own activities" on public.activities;
drop policy if exists "Users can insert their own activities" on public.activities;
drop policy if exists "Users can update their own activities" on public.activities;
drop policy if exists "Users can delete their own activities" on public.activities;

drop policy if exists "Users can view their own products" on public.products;
drop policy if exists "Users can insert their own products" on public.products;
drop policy if exists "Users can update their own products" on public.products;
drop policy if exists "Users can delete their own products" on public.products;

drop policy if exists "Users can view their own warehouses" on public.warehouses;
drop policy if exists "Users can insert their own warehouses" on public.warehouses;
drop policy if exists "Users can update their own warehouses" on public.warehouses;
drop policy if exists "Users can delete their own warehouses" on public.warehouses;

drop policy if exists "Users can view their own profile" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (auth.uid() = id);
create policy profiles_insert_own on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy profiles_update_own on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists warehouses_select_own on public.warehouses;
drop policy if exists warehouses_insert_own on public.warehouses;
drop policy if exists warehouses_update_own on public.warehouses;
drop policy if exists warehouses_delete_own on public.warehouses;
create policy warehouses_select_own on public.warehouses for select to authenticated using (auth.uid() = user_id);
create policy warehouses_insert_own on public.warehouses for insert to authenticated with check (auth.uid() = user_id);
create policy warehouses_update_own on public.warehouses for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy warehouses_delete_own on public.warehouses for delete to authenticated using (auth.uid() = user_id);

drop policy if exists products_select_own on public.products;
drop policy if exists products_insert_own on public.products;
drop policy if exists products_update_own on public.products;
drop policy if exists products_delete_own on public.products;
create policy products_select_own on public.products for select to authenticated using (auth.uid() = user_id);
create policy products_insert_own on public.products for insert to authenticated with check (auth.uid() = user_id);
create policy products_update_own on public.products for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists activities_select_own on public.activities;
drop policy if exists activities_insert_own on public.activities;
drop policy if exists activities_update_own on public.activities;
drop policy if exists activities_delete_own on public.activities;
create policy activities_select_own on public.activities for select to authenticated using (auth.uid() = user_id);
create policy activities_insert_own on public.activities for insert to authenticated with check (auth.uid() = user_id);
create policy activities_update_own on public.activities for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on table public.profiles, public.warehouses, public.products, public.activities from public, anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.warehouses to authenticated;
grant select, insert, update on table public.products, public.activities to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, username, avatar_url, updated_at)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), '得物卖家'),
    null,
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

commit;
