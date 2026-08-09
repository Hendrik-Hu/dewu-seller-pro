begin;

create or replace function public.list_orphan_warehouse_products()
returns table (
  id text,
  name text,
  sku text,
  size text,
  warehouse text,
  stock integer,
  status text,
  created_at timestamptz
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select p.id, p.name, p.sku, p.size, p.warehouse, p.stock, p.status, p.created_at
  from public.products p
  where p.user_id = auth.uid()
    and p.deleted_at is null
    and not exists (
      select 1 from public.warehouses w
      where w.user_id = p.user_id and w.name = p.warehouse
    )
  order by p.created_at, p.id;
$$;

create or replace function public.repair_orphan_product_warehouse(
  p_user_id uuid,
  p_product_id text,
  p_target_warehouse_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.products%rowtype;
  v_target public.warehouses%rowtype;
  v_audit_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then raise exception '请填写 3 到 500 个字符的核对依据'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into v_product from public.products
  where id = p_product_id and user_id = p_user_id and deleted_at is null
  for update;
  if not found then raise exception '商品不存在或无权访问'; end if;
  if exists (
    select 1 from public.warehouses
    where user_id = p_user_id and name = v_product.warehouse
  ) then raise exception '该商品仓库当前有效，不需要修复'; end if;

  select * into v_target from public.warehouses
  where id = p_target_warehouse_id and user_id = p_user_id
  for share;
  if not found then raise exception '目标仓库不存在或无权访问'; end if;

  if v_product.stock < 0 then
    perform set_config('app.inventory_anomaly_repair', 'allowed', true);
  end if;
  update public.products set warehouse = v_target.name
  where id = p_product_id and user_id = p_user_id;

  insert into public.data_repair_audit (
    user_id, target_table, record_id, field_name, old_value, new_value,
    old_status, new_status, reason
  ) values (
    p_user_id, 'products', p_product_id, 'stock',
    coalesce(v_product.stock, 0), coalesce(v_product.stock, 0),
    v_product.status, v_product.status,
    format('仓库修复：%s → %s；%s', coalesce(v_product.warehouse, '未设置'), v_target.name, v_reason)
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'audit_id', v_audit_id,
    'product_id', p_product_id,
    'old_warehouse', v_product.warehouse,
    'new_warehouse', v_target.name
  );
end;
$$;

revoke all on function public.list_orphan_warehouse_products() from public, anon;
revoke all on function public.repair_orphan_product_warehouse(uuid, text, uuid, text) from public, anon;
grant execute on function public.list_orphan_warehouse_products() to authenticated;
grant execute on function public.repair_orphan_product_warehouse(uuid, text, uuid, text) to authenticated;

commit;
