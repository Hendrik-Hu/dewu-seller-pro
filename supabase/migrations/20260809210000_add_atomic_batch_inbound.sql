alter table public.products add column if not exists source text;
alter table public.activities add column if not exists source text;

create table if not exists public.inbound_batches (
  user_id uuid not null,
  batch_id text not null,
  request jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, batch_id)
);

alter table public.inbound_batches add column if not exists request jsonb;
update public.inbound_batches set request = '[]'::jsonb where request is null;
alter table public.inbound_batches alter column request set not null;

alter table public.inbound_batches enable row level security;
revoke all on table public.inbound_batches from public, anon, authenticated;

create or replace function public.batch_inbound_products(
  p_rows jsonb,
  p_user_id uuid,
  p_batch_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_active public.products%rowtype;
  v_index integer := 0;
  v_count integer;
  v_quantity integer;
  v_cost numeric;
  v_sku text;
  v_size text;
  v_warehouse text;
  v_name text;
  v_brand text;
  v_image_url text;
  v_location text;
  v_source text;
  v_product_id text;
  v_total_stock integer;
  v_average_cost numeric;
  v_merged boolean;
  v_results jsonb := '[]'::jsonb;
  v_existing_result jsonb;
  v_existing_request jsonb;
  v_claimed integer;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if trim(coalesce(p_batch_id, '')) = '' then raise exception 'Batch id is required'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Inbound rows must be an array'; end if;

  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 12 then raise exception 'Inbound rows must contain between 1 and 12 variants'; end if;

  insert into public.inbound_batches (user_id, batch_id, request)
  values (p_user_id, p_batch_id, p_rows)
  on conflict (user_id, batch_id) do nothing;
  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    select request, result into v_existing_request, v_existing_result
    from public.inbound_batches
    where user_id = p_user_id and batch_id = p_batch_id;
    if v_existing_request is distinct from p_rows then raise exception 'Inbound batch payload does not match the original request'; end if;
    if v_existing_result is null then raise exception 'Inbound batch is still processing'; end if;
    return v_existing_result;
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_sku := upper(trim(coalesce(v_row->>'sku', '')));
    v_size := trim(coalesce(v_row->>'size', ''));
    v_warehouse := trim(coalesce(v_row->>'warehouse', ''));
    v_name := trim(coalesce(v_row->>'name', ''));
    v_brand := trim(coalesce(v_row->>'brand', ''));
    v_image_url := trim(coalesce(v_row->>'image_url', ''));
    v_location := trim(coalesce(v_row->>'location', ''));
    v_source := trim(coalesce(v_row->>'source', ''));
    v_product_id := trim(coalesce(v_row->>'id', ''));

    begin
      v_quantity := (v_row->>'quantity')::integer;
      v_cost := (v_row->>'cost')::numeric;
    exception when invalid_text_representation then
      raise exception 'Quantity and cost must be valid numbers';
    end;

    if v_sku = '' or v_size = '' or v_warehouse = '' or v_name = '' or v_brand = '' then
      raise exception 'SKU, size, warehouse, name, and brand are required';
    end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Quantity must be a positive integer'; end if;
    if v_cost is null or v_cost < 0 then raise exception 'Cost must be greater than or equal to 0'; end if;
    if v_product_id = '' then raise exception 'Product id is required'; end if;
    if not exists (select 1 from public.warehouses where user_id = p_user_id and name = v_warehouse) then
      raise exception 'Warehouse does not belong to the current user';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
      p_user_id::text || E'\x1f' || v_sku || E'\x1f' || v_size || E'\x1f' || v_warehouse,
      0
    ));

    select * into v_active
    from public.products
    where user_id = p_user_id
      and deleted_at is null
      and upper(trim(coalesce(sku, ''))) = v_sku
      and trim(coalesce(size, '')) = v_size
      and trim(coalesce(warehouse, '')) = v_warehouse
    order by created_at desc
    limit 1
    for update;

    if found then
      v_merged := true;
      v_total_stock := greatest(coalesce(v_active.stock, 0), 0) + v_quantity;
      v_average_cost := (
        coalesce(v_active.price, 0) * greatest(coalesce(v_active.stock, 0), 0)
        + v_cost * v_quantity
      ) / v_total_stock;

      update public.products
      set stock = v_total_stock,
          price = v_average_cost,
          name = v_name,
          brand = v_brand,
          status = 'instock',
          image_url = case when v_image_url <> '' then v_image_url else image_url end,
          location = case when v_location <> '' then v_location else location end,
          source = case when v_source <> '' then v_source else source end
      where id = v_active.id and user_id = p_user_id and deleted_at is null;

      v_product_id := v_active.id;
    else
      v_merged := false;
      insert into public.products (
        id, name, brand, size, sku, price, stock, image_url, status,
        location, created_at, warehouse, user_id, deleted_at, source
      ) values (
        v_product_id, v_name, v_brand, v_size, v_sku, v_cost, v_quantity,
        v_image_url, coalesce(nullif(v_row->>'status', ''), 'instock'),
        coalesce(nullif(v_location, ''), '待分配'), now(), v_warehouse, p_user_id, null, v_source
      );

      v_total_stock := v_quantity;
      v_average_cost := v_cost;
    end if;

    update public.products
    set name = v_name,
        brand = v_brand,
        image_url = case when v_image_url <> '' then v_image_url else image_url end
    where user_id = p_user_id and deleted_at is null and upper(trim(coalesce(sku, ''))) = v_sku;

    insert into public.activities (
      id, type, product_name, time, sku, size, price, cost, image_url,
      created_at, warehouse, count, user_id, platform, source
    ) values (
      'act-' || floor(extract(epoch from clock_timestamp()) * 1000000)::text || '-' || v_index,
      'inbound', v_name, '刚刚', v_sku, v_size, v_cost, v_cost, v_image_url,
      now(), v_warehouse, v_quantity, p_user_id, '手动批量入库', v_source
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'input_index', v_index,
      'product_id', v_product_id,
      'merged', v_merged,
      'stock', v_total_stock,
      'average_cost', round(v_average_cost, 2)
    ));
    v_index := v_index + 1;
  end loop;

  update public.inbound_batches
  set result = v_results
  where user_id = p_user_id and batch_id = p_batch_id;

  return v_results;
end;
$$;

revoke all on function public.batch_inbound_products(jsonb, uuid, text) from public, anon;
grant execute on function public.batch_inbound_products(jsonb, uuid, text) to authenticated;
