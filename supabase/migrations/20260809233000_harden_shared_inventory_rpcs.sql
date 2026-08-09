begin;

create or replace function public.batch_inbound_products(
  p_rows jsonb,
  p_user_id uuid,
  p_batch_id text,
  p_platform text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;

  v_result := public.batch_inbound_products(p_rows, p_user_id, p_batch_id);

  update public.activities activity
  set platform = coalesce(nullif(trim(p_platform), ''), '手动批量入库')
  where activity.user_id = p_user_id
    and activity.type = 'inbound'
    and activity.created_at = transaction_timestamp()
    and activity.platform = '手动批量入库'
    and exists (
      select 1
      from jsonb_array_elements(p_rows) row_data
      where upper(trim(coalesce(row_data->>'sku', ''))) = upper(trim(coalesce(activity.sku, '')))
        and trim(coalesce(row_data->>'size', '')) = trim(coalesce(activity.size, ''))
        and trim(coalesce(row_data->>'warehouse', '')) = trim(coalesce(activity.warehouse, ''))
    );

  return v_result;
end;
$$;

revoke all on function public.batch_inbound_products(jsonb, uuid, text, text) from public, anon;
grant execute on function public.batch_inbound_products(jsonb, uuid, text, text) to authenticated;

create or replace function public.outbound_product(
  p_product_id text,
  p_user_id uuid,
  p_sale_price numeric,
  p_quantity integer default 1,
  p_platform text default '得物'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.products%rowtype;
  v_new_stock integer;
  v_activity_id text;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than 0'; end if;
  if p_sale_price is null or p_sale_price < 0 then raise exception 'Sale price must be greater than or equal to 0'; end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and user_id = p_user_id
    and deleted_at is null
    and status = 'instock'
  for update;

  if not found then raise exception 'Active in-stock product not found'; end if;
  if coalesce(v_product.stock, 0) < p_quantity then raise exception 'Insufficient stock'; end if;

  v_new_stock := v_product.stock - p_quantity;

  update public.products
  set stock = v_new_stock,
      status = case when v_new_stock = 0 then 'sold' else 'instock' end
  where id = p_product_id
    and user_id = p_user_id
    and deleted_at is null
    and status = 'instock';

  v_activity_id := 'act-' || floor(extract(epoch from clock_timestamp()) * 1000000)::text;

  insert into public.activities (
    id, type, product_name, time, sku, size, price, cost, image_url,
    created_at, warehouse, count, user_id, platform
  ) values (
    v_activity_id, 'outbound', v_product.name, '刚刚', v_product.sku,
    v_product.size, p_sale_price, v_product.price, v_product.image_url,
    now(), v_product.warehouse, p_quantity, p_user_id,
    coalesce(nullif(trim(p_platform), ''), '得物')
  );

  return jsonb_build_object(
    'product_id', p_product_id,
    'activity_id', v_activity_id,
    'stock', v_new_stock
  );
end;
$$;

revoke all on function public.outbound_product(text, uuid, numeric, integer, text) from public, anon;
grant execute on function public.outbound_product(text, uuid, numeric, integer, text) to authenticated;

commit;
