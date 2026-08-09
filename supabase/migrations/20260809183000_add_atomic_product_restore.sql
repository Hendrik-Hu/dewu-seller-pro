create or replace function public.restore_product(
  p_product_id text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted public.products%rowtype;
  v_active public.products%rowtype;
  v_total_stock integer;
  v_average_cost numeric;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;

  select * into v_deleted
  from public.products
  where id = p_product_id and user_id = p_user_id and deleted_at is not null
  for update;

  if not found then raise exception 'Deleted product not found'; end if;

  select * into v_active
  from public.products
  where user_id = p_user_id
    and id <> p_product_id
    and deleted_at is null
    and upper(trim(coalesce(sku, ''))) = upper(trim(coalesce(v_deleted.sku, '')))
    and trim(coalesce(size, '')) = trim(coalesce(v_deleted.size, ''))
    and trim(coalesce(warehouse, '')) = trim(coalesce(v_deleted.warehouse, ''))
  order by created_at desc
  limit 1
  for update;

  if found then
    v_total_stock := greatest(coalesce(v_active.stock, 0), 0) + greatest(coalesce(v_deleted.stock, 0), 0);
    v_average_cost := case
      when v_total_stock > 0 then (
        coalesce(v_active.price, 0) * greatest(coalesce(v_active.stock, 0), 0)
        + coalesce(v_deleted.price, 0) * greatest(coalesce(v_deleted.stock, 0), 0)
      ) / v_total_stock
      else coalesce(v_active.price, v_deleted.price, 0)
    end;

    update public.products
    set stock = v_total_stock,
        price = v_average_cost,
        status = case when v_total_stock > 0 then 'instock' else status end,
        image_url = coalesce(nullif(v_deleted.image_url, ''), image_url),
        location = coalesce(nullif(v_deleted.location, ''), location),
        source = coalesce(nullif(v_deleted.source, ''), source)
    where id = v_active.id and user_id = p_user_id and deleted_at is null;

    delete from public.products where id = v_deleted.id and user_id = p_user_id;
    return jsonb_build_object('merged', true, 'product_id', v_active.id, 'stock', v_total_stock, 'average_cost', v_average_cost);
  end if;

  update public.products
  set deleted_at = null
  where id = v_deleted.id and user_id = p_user_id and deleted_at is not null;

  return jsonb_build_object('merged', false, 'product_id', v_deleted.id, 'stock', v_deleted.stock, 'average_cost', v_deleted.price);
end;
$$;

revoke all on function public.restore_product(text, uuid) from public, anon;
grant execute on function public.restore_product(text, uuid) to authenticated;
