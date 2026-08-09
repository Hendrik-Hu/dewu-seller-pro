begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  avatar_url text,
  updated_at timestamptz default now()
);

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  is_default boolean default false,
  unique (user_id, name)
);

create table if not exists public.products (
  id text primary key,
  name text not null,
  brand text,
  size text,
  sku text,
  price numeric,
  stock integer,
  image_url text,
  status text default 'instock',
  location text,
  created_at timestamptz not null default timezone('utc', now()),
  warehouse text,
  user_id uuid not null references auth.users(id) on delete cascade,
  deleted_at timestamptz,
  source text
);

create table if not exists public.activities (
  id text primary key,
  type text,
  product_name text,
  time text,
  sku text,
  price numeric,
  image_url text,
  created_at timestamptz not null default timezone('utc', now()),
  warehouse text,
  cost numeric,
  count numeric,
  user_id uuid not null references auth.users(id) on delete cascade,
  size text,
  platform text default '得物',
  source text
);

create index if not exists products_user_deleted_idx on public.products (user_id, deleted_at);
create index if not exists products_user_sku_idx on public.products (user_id, sku);
create index if not exists activities_user_created_idx on public.activities (user_id, created_at desc);
create index if not exists warehouses_user_created_idx on public.warehouses (user_id, created_at);

alter table public.profiles enable row level security;
alter table public.warehouses enable row level security;
alter table public.products enable row level security;
alter table public.activities enable row level security;

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
create policy products_select_own on public.products for select to authenticated using (auth.uid() = user_id);
create policy products_insert_own on public.products for insert to authenticated with check (auth.uid() = user_id);
create policy products_update_own on public.products for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists activities_select_own on public.activities;
drop policy if exists activities_insert_own on public.activities;
drop policy if exists activities_update_own on public.activities;
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;
