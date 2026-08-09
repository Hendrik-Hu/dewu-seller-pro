create table if not exists public.inventory_transfers (
  user_id uuid not null,
  operation_id text not null,
  request jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

alter table public.inventory_transfers enable row level security;
revoke all on table public.inventory_transfers from public, anon, authenticated;

create or replace function public.transfer_product(
  p_product_id text,
  p_user_id uuid,
  p_target_warehouse text,
  p_quantity integer,
  p_target_location text,
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.products%rowtype;
  v_target public.products%rowtype;
  v_request jsonb;
  v_existing_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_claimed integer;
  v_source_stock integer;
  v_target_stock integer;
  v_target_cost numeric;
  v_target_id text;
  v_target_found boolean;
  v_source_lock_key bigint;
  v_target_lock_key bigint;
  v_target_warehouse text := trim(coalesce(p_target_warehouse, ''));
  v_target_location text := trim(coalesce(p_target_location, ''));
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if trim(coalesce(p_operation_id, '')) = '' then raise exception 'Operation id is required'; end if;
  if trim(coalesce(p_product_id, '')) = '' then raise exception 'Product id is required'; end if;
  if v_target_warehouse = '' then raise exception 'Target warehouse is required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be a positive integer'; end if;

  v_request := jsonb_build_object(
    'product_id', p_product_id,
    'target_warehouse', v_target_warehouse,
    'quantity', p_quantity,
    'target_location', v_target_location
  );

  insert into public.inventory_transfers (user_id, operation_id, request)
  values (p_user_id, p_operation_id, v_request)
  on conflict (user_id, operation_id) do nothing;
  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    select request, result into v_existing_request, v_existing_result
    from public.inventory_transfers
    where user_id = p_user_id and operation_id = p_operation_id;
    if v_existing_request is distinct from v_request then raise exception 'Transfer payload does not match the original request'; end if;
    if v_existing_result is null then raise exception 'Transfer is still processing'; end if;
    return v_existing_result;
  end if;

  select * into v_source
  from public.products
  where id = p_product_id and user_id = p_user_id and deleted_at is null;
  if not found then raise exception 'Source product not found'; end if;
  if v_source.status is distinct from 'instock' then raise exception 'Only instock products can be transferred'; end if;

  if trim(coalesce(v_source.warehouse, '')) = v_target_warehouse then raise exception 'Target warehouse must differ from source warehouse'; end if;
  if not exists (select 1 from public.warehouses where user_id = p_user_id and name = v_target_warehouse) then
    raise exception 'Target warehouse does not belong to the current user';
  end if;

  v_source_lock_key := hashtextextended(
    p_user_id::text || E'\x1f'
    || upper(trim(coalesce(v_source.sku, ''))) || E'\x1f'
    || trim(coalesce(v_source.size, '')) || E'\x1f'
    || trim(coalesce(v_source.warehouse, '')),
    0
  );
  v_target_lock_key := hashtextextended(
    p_user_id::text || E'\x1f'
    || upper(trim(coalesce(v_source.sku, ''))) || E'\x1f'
    || trim(coalesce(v_source.size, '')) || E'\x1f'
    || v_target_warehouse,
    0
  );
  perform pg_advisory_xact_lock(least(v_source_lock_key, v_target_lock_key));
  perform pg_advisory_xact_lock(greatest(v_source_lock_key, v_target_lock_key));

  select * into v_source
  from public.products
  where id = p_product_id and user_id = p_user_id and deleted_at is null
  for update;
  if not found then raise exception 'Source product not found'; end if;
  if v_source.status is distinct from 'instock' then raise exception 'Only instock products can be transferred'; end if;
  if greatest(coalesce(v_source.stock, 0), 0) < p_quantity then raise exception 'Insufficient source stock'; end if;

  select * into v_target
  from public.products
  where user_id = p_user_id
    and deleted_at is null
    and upper(trim(coalesce(sku, ''))) = upper(trim(coalesce(v_source.sku, '')))
    and trim(coalesce(size, '')) = trim(coalesce(v_source.size, ''))
    and trim(coalesce(warehouse, '')) = v_target_warehouse
  order by created_at desc
  limit 1
  for update;
  v_target_found := found;

  v_source_stock := greatest(coalesce(v_source.stock, 0), 0) - p_quantity;
  update public.products
  set stock = v_source_stock,
      status = case when v_source_stock = 0 then 'sold' else 'instock' end
  where id = v_source.id and user_id = p_user_id and deleted_at is null;

  if v_target_found then
    v_target_stock := greatest(coalesce(v_target.stock, 0), 0) + p_quantity;
    v_target_cost := (
      coalesce(v_target.price, 0) * greatest(coalesce(v_target.stock, 0), 0)
      + coalesce(v_source.price, 0) * p_quantity
    ) / v_target_stock;
    v_target_id := v_target.id;

    update public.products
    set stock = v_target_stock,
        price = v_target_cost,
        status = 'instock',
        name = v_source.name,
        brand = v_source.brand,
        image_url = coalesce(nullif(v_source.image_url, ''), image_url),
        location = case when v_target_location <> '' then v_target_location else location end,
        source = coalesce(nullif(source, ''), v_source.source)
    where id = v_target.id and user_id = p_user_id and deleted_at is null;
  else
    v_target_stock := p_quantity;
    v_target_cost := coalesce(v_source.price, 0);
    v_target_id := 'transfer-' || p_operation_id;

    insert into public.products (
      id, name, brand, size, sku, price, stock, image_url, status,
      location, created_at, warehouse, user_id, deleted_at, source
    ) values (
      v_target_id, v_source.name, v_source.brand, v_source.size, v_source.sku,
      v_target_cost, v_target_stock, v_source.image_url, 'instock',
      coalesce(nullif(v_target_location, ''), '待分配'), now(), v_target_warehouse,
      p_user_id, null, v_source.source
    );
  end if;

  insert into public.activities (
    id, type, product_name, time, sku, size, price, cost, image_url,
    created_at, warehouse, count, user_id, platform, source
  ) values (
    'act-' || floor(extract(epoch from clock_timestamp()) * 1000000)::text,
    'transfer', v_source.name, '刚刚', v_source.sku, v_source.size,
    coalesce(v_source.price, 0), coalesce(v_source.price, 0), v_source.image_url,
    now(), trim(coalesce(v_source.warehouse, '')) || ' → ' || v_target_warehouse,
    p_quantity, p_user_id, '仓库调拨', v_source.source
  );

  v_result := jsonb_build_object(
    'source_product_id', v_source.id,
    'target_product_id', v_target_id,
    'source_stock', v_source_stock,
    'target_stock', v_target_stock,
    'quantity', p_quantity,
    'source_warehouse', v_source.warehouse,
    'target_warehouse', v_target_warehouse
  );

  update public.inventory_transfers
  set result = v_result
  where user_id = p_user_id and operation_id = p_operation_id;

  return v_result;
end;
$$;

revoke all on function public.transfer_product(text, uuid, text, integer, text, text) from public, anon;
grant execute on function public.transfer_product(text, uuid, text, integer, text, text) to authenticated;
