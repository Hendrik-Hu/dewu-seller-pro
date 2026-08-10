begin;

create table if not exists public.inventory_adjustment_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  request_hash text not null,
  product_id text not null,
  sku text not null,
  size text not null,
  warehouse text not null,
  old_stock integer not null,
  new_stock integer not null,
  old_cost numeric(12,2) not null,
  new_cost numeric(12,2) not null,
  old_status text not null,
  new_status text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (user_id, operation_id),
  constraint inventory_adjustment_stock_check check (old_stock >= 0 and new_stock >= 0),
  constraint inventory_adjustment_cost_check check (old_cost >= 0 and new_cost >= 0),
  constraint inventory_adjustment_status_check check (
    old_status in ('instock','shipping','sold','flaw') and new_status in ('instock','shipping','sold','flaw')
  ),
  constraint inventory_adjustment_reason_check check (char_length(btrim(reason)) between 4 and 500)
);

create index if not exists inventory_adjustment_user_created_idx
  on public.inventory_adjustment_audit (user_id, created_at desc, id desc);
create index if not exists inventory_adjustment_product_created_idx
  on public.inventory_adjustment_audit (user_id, product_id, created_at desc);

alter table public.inventory_adjustment_audit enable row level security;
drop policy if exists inventory_adjustment_select_own on public.inventory_adjustment_audit;
create policy inventory_adjustment_select_own on public.inventory_adjustment_audit
  for select to authenticated using (auth.uid() = user_id);
revoke all on table public.inventory_adjustment_audit from public, anon, authenticated;
grant select on table public.inventory_adjustment_audit to authenticated;

create or replace function public.update_product_metadata(
  p_product_id text,
  p_name text,
  p_brand text,
  p_location text default '',
  p_source text default '',
  p_image_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_product public.products%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_brand text := btrim(coalesce(p_brand, ''));
  v_location text := btrim(coalesce(p_location, ''));
  v_source text := btrim(coalesce(p_source, ''));
  v_image_ref text := nullif(btrim(coalesce(p_image_ref, '')), '');
  v_sku text;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if char_length(v_name) not between 1 and 160 then raise exception '商品名称应为 1 到 160 个字符'; end if;
  if char_length(v_brand) not between 1 and 80 then raise exception '品牌应为 1 到 80 个字符'; end if;
  if char_length(v_location) > 120 then raise exception '库位不能超过 120 个字符'; end if;
  if char_length(v_source) > 240 then raise exception '来源备注不能超过 240 个字符'; end if;
  if v_image_ref is not null and v_image_ref not like 'storage://product-images/' || v_user_id::text || '/%' then
    raise exception '商品主图必须来自当前账号的私有图片目录';
  end if;

  select * into v_product from public.products
  where id = p_product_id and user_id = v_user_id and deleted_at is null;
  if not found then raise exception '商品不存在或已在回收站'; end if;
  v_sku := upper(btrim(coalesce(v_product.sku, '')));

  perform pg_advisory_xact_lock(hashtextextended(
    'product-master:' || v_user_id::text || E'\x1f' || v_sku, 0
  ));

  select * into v_product from public.products
  where id = p_product_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then raise exception '商品不存在或已在回收站'; end if;
  if upper(btrim(coalesce(v_product.sku, ''))) is distinct from v_sku then
    raise exception '商品货号在编辑期间发生变化，请刷新后重试';
  end if;

  update public.products
  set name = v_name,
      brand = v_brand,
      image_url = case when v_image_ref is null then image_url else v_image_ref end
  where user_id = v_user_id
    and deleted_at is null
    and upper(btrim(coalesce(sku, ''))) = v_sku;

  update public.products
  set location = v_location,
      source = v_source
  where id = p_product_id and user_id = v_user_id and deleted_at is null;

  return jsonb_build_object('productId', p_product_id, 'sku', v_product.sku, 'updated', true);
end;
$$;

create or replace function public.soft_delete_products(p_product_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_requested integer;
  v_updated integer;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  v_requested := coalesce(array_length(p_product_ids, 1), 0);
  if v_requested < 1 or v_requested > 100 then raise exception '单次回收站操作应包含 1 到 100 条商品'; end if;
  if exists (select 1 from unnest(p_product_ids) id where id is null or btrim(id) = '' or char_length(id) > 200)
    or (select count(*) from (select distinct id from unnest(p_product_ids) id) distinct_ids) <> v_requested then
    raise exception '商品标识无效';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('product-delete:' || v_user_id::text, 0));
  update public.products
  set deleted_at = now()
  where user_id = v_user_id and deleted_at is null and id = any(p_product_ids);
  get diagnostics v_updated = row_count;
  if v_updated <> v_requested then raise exception '部分商品不存在、已在回收站或不属于当前账号，请刷新后重试'; end if;
  return jsonb_build_object('requested', v_requested, 'moved', v_updated);
end;
$$;

create or replace function public.complete_pending_products(p_product_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_requested integer := coalesce(array_length(p_product_ids, 1), 0);
  v_updated integer;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if v_requested < 1 or v_requested > 100 then raise exception '单次待发货处理应包含 1 到 100 条商品'; end if;
  if exists (select 1 from unnest(p_product_ids) id where id is null or btrim(id) = '' or char_length(id) > 200)
    or (select count(*) from (select distinct id from unnest(p_product_ids) id) distinct_ids) <> v_requested then
    raise exception '商品标识无效或重复';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pending-complete:' || v_user_id::text, 0));
  update public.products set status = 'sold'
  where user_id = v_user_id and deleted_at is null and status = 'shipping' and id = any(p_product_ids);
  get diagnostics v_updated = row_count;
  if v_updated <> v_requested then raise exception '部分商品已不在待发货状态，请刷新后重试'; end if;
  return jsonb_build_object('completed', v_updated);
end;
$$;

create or replace function public.adjust_product_inventory(
  p_product_id text,
  p_operation_id text,
  p_expected_stock integer,
  p_expected_cost numeric,
  p_expected_status text,
  p_new_stock integer,
  p_new_cost numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_product public.products%rowtype;
  v_existing public.inventory_adjustment_audit%rowtype;
  v_operation_id text := btrim(coalesce(p_operation_id, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_new_cost numeric(12,2) := round(p_new_cost, 2);
  v_new_status text;
  v_request_hash text;
  v_audit_id uuid;
  v_locked_sku text;
  v_locked_size text;
  v_locked_warehouse text;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if char_length(v_operation_id) not between 8 and 120 then raise exception '调整操作标识无效'; end if;
  if p_new_stock is null or p_new_stock < 0 or p_new_stock > 1000000 then raise exception '库存应为 0 到 1000000 的整数'; end if;
  if p_new_cost is null or p_new_cost::text in ('NaN', 'Infinity', '-Infinity')
    or p_new_cost < 0 or p_new_cost > 1000000 then raise exception '平均成本应为 0 到 1000000 元'; end if;
  if char_length(v_reason) not between 4 and 500 then raise exception '请填写 4 到 500 个字符的核对原因'; end if;
  if p_expected_stock is null or p_expected_stock < 0 or p_expected_stock > 1000000 then raise exception '原库存前置条件无效'; end if;
  if p_expected_cost is null or p_expected_cost::text in ('NaN', 'Infinity', '-Infinity')
    or p_expected_cost < 0 or p_expected_cost > 1000000 then raise exception '原成本前置条件无效'; end if;
  if p_expected_status not in ('instock','shipping','sold','flaw') then raise exception '原状态前置条件无效'; end if;

  v_request_hash := encode(extensions.digest(convert_to(
    v_user_id::text || E'\x1f' || coalesce(p_product_id, '') || E'\x1f' || p_expected_stock::text || E'\x1f' ||
    round(p_expected_cost, 2)::text || E'\x1f' || p_expected_status || E'\x1f' || p_new_stock::text || E'\x1f' ||
    v_new_cost::text || E'\x1f' || v_reason, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-adjustment-operation:' || v_user_id::text || E'\x1f' || v_operation_id, 0
  ));

  select * into v_existing from public.inventory_adjustment_audit
  where user_id = v_user_id and operation_id = v_operation_id;
  if found then
    if v_existing.request_hash is distinct from v_request_hash then raise exception '调整操作标识已绑定其他内容'; end if;
    return jsonb_build_object(
      'auditId', v_existing.id, 'productId', v_existing.product_id, 'oldStock', v_existing.old_stock,
      'newStock', v_existing.new_stock, 'oldCost', v_existing.old_cost, 'newCost', v_existing.new_cost,
      'oldStatus', v_existing.old_status, 'newStatus', v_existing.new_status, 'replayed', true
    );
  end if;

  select * into v_product from public.products
  where id = p_product_id and user_id = v_user_id and deleted_at is null;
  if not found then raise exception '商品不存在或已在回收站'; end if;
  v_locked_sku := upper(btrim(coalesce(v_product.sku, '')));
  v_locked_size := btrim(coalesce(v_product.size, ''));
  v_locked_warehouse := btrim(coalesce(v_product.warehouse, ''));

  perform pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || E'\x1f' || v_locked_sku || E'\x1f' || v_locked_size || E'\x1f' || v_locked_warehouse, 0
  ));

  select * into v_product from public.products
  where id = p_product_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then raise exception '商品不存在或已在回收站'; end if;
  if upper(btrim(coalesce(v_product.sku, ''))) is distinct from v_locked_sku
    or btrim(coalesce(v_product.size, '')) is distinct from v_locked_size
    or btrim(coalesce(v_product.warehouse, '')) is distinct from v_locked_warehouse then
    raise exception '商品变体在调整期间发生变化，请刷新后重试';
  end if;
  if coalesce(v_product.stock, 0) is distinct from p_expected_stock
    or round(coalesce(v_product.price, 0), 2) is distinct from round(p_expected_cost, 2)
    or v_product.status is distinct from p_expected_status then
    raise exception '库存或成本已发生变化，请刷新后重新盘点';
  end if;

  if coalesce(v_product.stock, 0) = p_new_stock and round(coalesce(v_product.price, 0), 2) = v_new_cost then
    raise exception '库存和平均成本均未变化';
  end if;
  v_new_status := case
    when v_product.status = 'sold' and p_new_stock > 0 then 'instock'
    when v_product.status = 'instock' and p_new_stock = 0 then 'sold'
    else v_product.status
  end;

  insert into public.inventory_adjustment_audit (
    user_id, operation_id, request_hash, product_id, sku, size, warehouse,
    old_stock, new_stock, old_cost, new_cost, old_status, new_status, reason
  ) values (
    v_user_id, v_operation_id, v_request_hash, v_product.id, coalesce(v_product.sku, ''),
    coalesce(v_product.size, ''), coalesce(v_product.warehouse, ''), coalesce(v_product.stock, 0),
    p_new_stock, round(coalesce(v_product.price, 0), 2), v_new_cost, v_product.status, v_new_status, v_reason
  ) returning id into v_audit_id;

  update public.products set stock = p_new_stock, price = v_new_cost, status = v_new_status
  where id = v_product.id and user_id = v_user_id;

  return jsonb_build_object(
    'auditId', v_audit_id, 'productId', v_product.id, 'oldStock', coalesce(v_product.stock, 0),
    'newStock', p_new_stock, 'oldCost', round(coalesce(v_product.price, 0), 2), 'newCost', v_new_cost,
    'oldStatus', v_product.status, 'newStatus', v_new_status, 'replayed', false
  );
end;
$$;

revoke all on function public.update_product_metadata(text,text,text,text,text,text) from public, anon;
revoke all on function public.soft_delete_products(text[]) from public, anon;
revoke all on function public.complete_pending_products(text[]) from public, anon;
revoke all on function public.adjust_product_inventory(text,text,integer,numeric,text,integer,numeric,text) from public, anon;
grant execute on function public.update_product_metadata(text,text,text,text,text,text) to authenticated;
grant execute on function public.soft_delete_products(text[]) to authenticated;
grant execute on function public.complete_pending_products(text[]) to authenticated;
grant execute on function public.adjust_product_inventory(text,text,integer,numeric,text,integer,numeric,text) to authenticated;

drop policy if exists products_insert_own on public.products;
drop policy if exists products_update_own on public.products;
drop policy if exists activities_insert_own on public.activities;
drop policy if exists activities_update_own on public.activities;
revoke insert, update on table public.products from authenticated;
revoke insert, update on table public.activities from authenticated;
grant select on table public.products, public.activities to authenticated;

commit;
