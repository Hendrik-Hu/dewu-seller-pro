begin;

do $$
begin
  if exists (
    select 1 from public.warehouses
    where name is null or btrim(name) = '' or name <> btrim(name) or char_length(name) > 60
  ) then
    raise exception 'warehouse data contains invalid names; review before applying constraints';
  end if;

  if exists (
    select 1 from public.warehouses
    group by user_id, lower(btrim(name))
    having count(*) > 1
  ) then
    raise exception 'warehouse data contains duplicate normalized names';
  end if;

  if exists (
    select 1 from public.warehouses
    group by user_id
    having count(*) > 6
  ) then
    raise exception 'warehouse data contains users with more than six warehouses';
  end if;

  if exists (
    select 1 from public.warehouses
    group by user_id
    having count(*) filter (where is_default) <> 1
  ) then
    raise exception 'warehouse data contains invalid default warehouse counts';
  end if;
end;
$$;

alter table public.warehouses
  drop constraint if exists warehouses_name_valid;
alter table public.warehouses
  add constraint warehouses_name_valid
  check (name = btrim(name) and char_length(name) between 1 and 60);

create unique index if not exists warehouses_user_normalized_name_unique
  on public.warehouses (user_id, lower(btrim(name)));

create unique index if not exists warehouses_one_default_per_user
  on public.warehouses (user_id)
  where is_default;

create or replace function public.guard_warehouse_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  select count(*) into v_count from public.warehouses where user_id = new.user_id;
  if v_count >= 6 then raise exception '最多允许设置 6 个仓库'; end if;
  if v_count = 0 then
    new.is_default := true;
  elsif new.is_default and exists (
    select 1 from public.warehouses where user_id = new.user_id and is_default
  ) then
    new.is_default := false;
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;

drop trigger if exists warehouses_guard_insert on public.warehouses;
create trigger warehouses_guard_insert
before insert on public.warehouses
for each row execute function public.guard_warehouse_insert();

create or replace function public.guard_product_warehouse_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.user_id is distinct from old.user_id or new.warehouse is distinct from old.warehouse then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
    if not exists (
      select 1 from public.warehouses
      where user_id = new.user_id and name = new.warehouse
    ) then
      raise exception '仓库不存在，请先创建或选择有效仓库';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists products_guard_warehouse_reference on public.products;
create trigger products_guard_warehouse_reference
before insert or update of user_id, warehouse on public.products
for each row execute function public.guard_product_warehouse_reference();

alter function public.restore_ledger_backup(uuid, text, jsonb, boolean)
  rename to restore_ledger_backup_pre_warehouse_v11;
revoke all on function public.restore_ledger_backup_pre_warehouse_v11(uuid, text, jsonb, boolean)
  from public, anon, authenticated;

create or replace function public.restore_ledger_backup(
  p_user_id uuid,
  p_operation_id text,
  p_package jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_warehouses jsonb := case
    when jsonb_typeof(p_package#>'{data,warehouses}') = 'array' then p_package#>'{data,warehouses}'
    else '[]'::jsonb
  end;
begin
  if exists (
    select 1
    from jsonb_array_elements(v_warehouses) row(value)
    where jsonb_typeof(row.value) = 'object'
      and btrim(coalesce(row.value->>'name', '')) <> coalesce(row.value->>'name', '')
  ) then
    raise exception '备份包仓库名称包含首尾空白，请修正后重新预检';
  end if;

  if exists (
    select lower(btrim(row.value->>'name'))
    from jsonb_array_elements(v_warehouses) row(value)
    where jsonb_typeof(row.value) = 'object' and btrim(coalesce(row.value->>'name', '')) <> ''
    group by lower(btrim(row.value->>'name'))
    having count(*) > 1
  ) then
    raise exception '备份包包含大小写或空白归一后同名的仓库，请合并后重新预检';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_warehouses) row(value)
    join public.warehouses warehouse
      on warehouse.user_id = p_user_id
      and lower(btrim(warehouse.name)) = lower(btrim(row.value->>'name'))
      and warehouse.name <> row.value->>'name'
    where jsonb_typeof(row.value) = 'object'
  ) then
    raise exception '备份包仓库与当前账号已有仓库规范化同名，请改名后重新预检';
  end if;

  return public.restore_ledger_backup_pre_warehouse_v11(
    p_user_id, p_operation_id, p_package, p_dry_run
  );
end;
$$;

create or replace function public.create_warehouse(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_row public.warehouses%rowtype;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception '仓库名称应为 1 到 60 个字符';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));
  select count(*) into v_count from public.warehouses where user_id = v_user_id;
  if v_count >= 6 then
    raise exception '最多允许设置 6 个仓库';
  end if;
  if exists (
    select 1 from public.warehouses
    where user_id = v_user_id and lower(btrim(name)) = lower(v_name)
  ) then
    raise exception '仓库名称已存在';
  end if;

  insert into public.warehouses (user_id, name, is_default, created_at)
  values (v_user_id, v_name, v_count = 0, now())
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.set_default_warehouse(p_warehouse_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.warehouses%rowtype;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select * into v_row from public.warehouses
  where id = p_warehouse_id and user_id = v_user_id
  for update;
  if not found then raise exception '仓库不存在或无权访问'; end if;

  update public.warehouses set is_default = false
  where user_id = v_user_id and is_default;
  update public.warehouses set is_default = true
  where id = p_warehouse_id and user_id = v_user_id;

  select * into v_row from public.warehouses where id = p_warehouse_id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.rename_warehouse(p_warehouse_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_old_name text;
  v_row public.warehouses%rowtype;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception '仓库名称应为 1 到 60 个字符';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select name into v_old_name from public.warehouses
  where id = p_warehouse_id and user_id = v_user_id
  for update;
  if not found then raise exception '仓库不存在或无权访问'; end if;
  if exists (
    select 1 from public.warehouses
    where user_id = v_user_id and id <> p_warehouse_id
      and lower(btrim(name)) = lower(v_name)
  ) then
    raise exception '仓库名称已存在';
  end if;

  update public.warehouses set name = v_name where id = p_warehouse_id
  returning * into v_row;
  update public.products
  set warehouse = v_name
  where user_id = v_user_id and warehouse = v_old_name;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.delete_warehouse(p_warehouse_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.warehouses%rowtype;
  v_next_id uuid;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select * into v_row from public.warehouses
  where id = p_warehouse_id and user_id = v_user_id
  for update;
  if not found then raise exception '仓库不存在或无权访问'; end if;

  if exists (
    select 1 from public.products
    where user_id = v_user_id and warehouse = v_row.name and stock > 0
  ) then
    raise exception '该仓库仍有库存，请先调拨或清空后再删除';
  end if;

  if v_row.is_default then
    select id into v_next_id from public.warehouses
    where user_id = v_user_id and id <> p_warehouse_id
    order by created_at, id
    limit 1;
    if v_next_id is not null then
      update public.warehouses set is_default = false where id = p_warehouse_id;
      update public.warehouses set is_default = true where id = v_next_id;
    end if;
  end if;

  delete from public.warehouses where id = p_warehouse_id;
  return jsonb_build_object('deletedId', p_warehouse_id, 'nextDefaultId', v_next_id);
end;
$$;

revoke insert, update, delete on table public.warehouses from authenticated;
drop policy if exists warehouses_insert_own on public.warehouses;
drop policy if exists warehouses_update_own on public.warehouses;
drop policy if exists warehouses_delete_own on public.warehouses;

revoke all on function public.create_warehouse(text) from public, anon;
revoke all on function public.set_default_warehouse(uuid) from public, anon;
revoke all on function public.rename_warehouse(uuid, text) from public, anon;
revoke all on function public.delete_warehouse(uuid) from public, anon;
revoke all on function public.restore_ledger_backup(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.create_warehouse(text) to authenticated;
grant execute on function public.set_default_warehouse(uuid) to authenticated;
grant execute on function public.rename_warehouse(uuid, text) to authenticated;
grant execute on function public.delete_warehouse(uuid) to authenticated;
grant execute on function public.restore_ledger_backup(uuid, text, jsonb, boolean) to authenticated;

commit;
