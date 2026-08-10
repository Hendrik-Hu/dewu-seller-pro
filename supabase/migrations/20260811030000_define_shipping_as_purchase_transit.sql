begin;

-- `shipping` is purchasing inventory in transit. It is not an outbound order.
alter function public.get_inventory_analytics(timestamptz)
  rename to get_inventory_analytics_pre_transit_v15;

revoke all on function public.get_inventory_analytics_pre_transit_v15(timestamptz)
  from public, anon, authenticated;

create function public.get_inventory_analytics(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_dashboard jsonb;
begin
  v_result := public.get_inventory_analytics_pre_transit_v15(p_as_of);
  v_dashboard := (v_result->'dashboard') - 'pendingOrderCount';
  v_dashboard := jsonb_set(
    v_dashboard,
    '{shippingProductCount}',
    coalesce(v_result#>'{dashboard,pendingOrderCount}', '0'::jsonb),
    true
  );
  v_result := jsonb_set(v_result - 'pendingProducts', '{dashboard}', v_dashboard, true);
  return jsonb_set(v_result, '{shippingProducts}', '[]'::jsonb, true);
end;
$$;

revoke all on function public.get_inventory_analytics(timestamptz) from public, anon;
grant execute on function public.get_inventory_analytics(timestamptz) to authenticated;

-- Preserve the ordinary adjustment implementation for compatible callers.
alter function public.adjust_product_inventory(text,text,integer,numeric,text,integer,numeric,text)
  rename to adjust_product_inventory_pre_transit_v15;

revoke all on function public.adjust_product_inventory_pre_transit_v15(text,text,integer,numeric,text,integer,numeric,text)
  from public, anon, authenticated;

create function public.adjust_product_inventory(
  p_product_id text,
  p_operation_id text,
  p_expected_stock integer,
  p_expected_cost numeric,
  p_expected_status text,
  p_new_stock integer,
  p_new_cost numeric,
  p_reason text,
  p_target_status text
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
  v_expected_cost numeric(12,2) := round(p_expected_cost, 2);
  v_new_cost numeric(12,2) := round(p_new_cost, 2);
  v_request_hash text;
  v_audit_id uuid;
  v_locked_sku text;
  v_locked_size text;
  v_locked_warehouse text;
begin
  if p_target_status is null then
    return public.adjust_product_inventory_pre_transit_v15(
      p_product_id, p_operation_id, p_expected_stock, p_expected_cost,
      p_expected_status, p_new_stock, p_new_cost, p_reason
    );
  end if;
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_expected_status <> 'shipping' or p_target_status <> 'instock' then
    raise exception '只允许将采购运输中商品确认到仓';
  end if;
  if char_length(v_operation_id) not between 8 and 120 then raise exception '调整操作标识无效'; end if;
  if p_expected_stock is null or p_expected_stock <= 0 or p_expected_stock > 1000000 then
    raise exception '运输中商品库存必须大于 0';
  end if;
  if p_expected_cost is null or p_expected_cost::text in ('NaN','Infinity','-Infinity')
    or p_expected_cost < 0 or p_expected_cost > 1000000 then raise exception '原成本前置条件无效'; end if;
  if p_new_stock is distinct from p_expected_stock or v_new_cost is distinct from v_expected_cost then
    raise exception '到仓核对不能改变库存或成本，如有差异请另做盘点';
  end if;
  if char_length(v_reason) not between 4 and 500 then raise exception '请填写 4 到 500 个字符的到仓核对依据'; end if;

  v_request_hash := encode(extensions.digest(convert_to(
    v_user_id::text || E'\x1f' || coalesce(p_product_id,'') || E'\x1f' ||
    p_expected_stock::text || E'\x1f' || v_expected_cost::text || E'\x1f' ||
    p_expected_status || E'\x1f' || p_new_stock::text || E'\x1f' || v_new_cost::text ||
    E'\x1f' || p_target_status || E'\x1f' || v_reason,
    'UTF8'
  ), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-adjustment-operation:' || v_user_id::text || E'\x1f' || v_operation_id, 0
  ));
  select * into v_existing from public.inventory_adjustment_audit
  where user_id = v_user_id and operation_id = v_operation_id;
  if found then
    if v_existing.request_hash is distinct from v_request_hash then raise exception '调整操作标识已绑定其他内容'; end if;
    return jsonb_build_object(
      'auditId',v_existing.id,'productId',v_existing.product_id,
      'oldStock',v_existing.old_stock,'newStock',v_existing.new_stock,
      'oldCost',v_existing.old_cost,'newCost',v_existing.new_cost,
      'oldStatus',v_existing.old_status,'newStatus',v_existing.new_status,'replayed',true
    );
  end if;

  select * into v_product from public.products
  where id = p_product_id and user_id = v_user_id and deleted_at is null;
  if not found then raise exception '商品不存在或已在回收站'; end if;
  v_locked_sku := upper(btrim(coalesce(v_product.sku,'')));
  v_locked_size := btrim(coalesce(v_product.size,''));
  v_locked_warehouse := btrim(coalesce(v_product.warehouse,''));
  perform pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || E'\x1f' || v_locked_sku || E'\x1f' || v_locked_size || E'\x1f' || v_locked_warehouse, 0
  ));
  select * into v_product from public.products
  where id = p_product_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then raise exception '商品不存在或已在回收站'; end if;
  if upper(btrim(coalesce(v_product.sku,''))) is distinct from v_locked_sku
    or btrim(coalesce(v_product.size,'')) is distinct from v_locked_size
    or btrim(coalesce(v_product.warehouse,'')) is distinct from v_locked_warehouse then
    raise exception '商品变体在核对期间发生变化，请刷新后重试';
  end if;
  if v_product.status is distinct from p_expected_status
    or coalesce(v_product.stock,0) is distinct from p_expected_stock
    or round(coalesce(v_product.price,0),2) is distinct from v_expected_cost then
    raise exception '库存、成本或状态已发生变化，请刷新后重新核对';
  end if;

  insert into public.inventory_adjustment_audit(
    user_id,operation_id,request_hash,product_id,sku,size,warehouse,
    old_stock,new_stock,old_cost,new_cost,old_status,new_status,reason
  ) values (
    v_user_id,v_operation_id,v_request_hash,v_product.id,coalesce(v_product.sku,''),
    coalesce(v_product.size,''),coalesce(v_product.warehouse,''),p_expected_stock,
    p_new_stock,v_expected_cost,v_new_cost,'shipping','instock',v_reason
  ) returning id into v_audit_id;
  update public.products set status = 'instock'
  where id = v_product.id and user_id = v_user_id;

  return jsonb_build_object(
    'auditId',v_audit_id,'productId',v_product.id,'oldStock',p_expected_stock,
    'newStock',p_new_stock,'oldCost',v_expected_cost,'newCost',v_new_cost,
    'oldStatus','shipping','newStatus','instock','replayed',false
  );
end;
$$;

create function public.adjust_product_inventory(
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
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.adjust_product_inventory_pre_transit_v15(
    p_product_id,p_operation_id,p_expected_stock,p_expected_cost,
    p_expected_status,p_new_stock,p_new_cost,p_reason
  );
$$;

revoke all on function public.adjust_product_inventory(text,text,integer,numeric,text,integer,numeric,text,text) from public, anon;
revoke all on function public.adjust_product_inventory(text,text,integer,numeric,text,integer,numeric,text) from public, anon;
grant execute on function public.adjust_product_inventory(text,text,integer,numeric,text,integer,numeric,text,text) to authenticated;
grant execute on function public.adjust_product_inventory(text,text,integer,numeric,text,integer,numeric,text) to authenticated;

-- Do not silently merge purchasing transit into an existing warehouse variant.
-- The older core always marks merged rows instock, so transit rows must be new variants.
alter function public.batch_inbound_products(jsonb,uuid,text)
  rename to batch_inbound_products_pre_transit_v15;

revoke all on function public.batch_inbound_products_pre_transit_v15(jsonb,uuid,text)
  from public, anon, authenticated;

create function public.batch_inbound_products(
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
  v_sku text;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if jsonb_typeof(p_rows) = 'array'
    and not exists (select 1 from jsonb_array_elements(p_rows) item where jsonb_typeof(item) <> 'object') then
    for v_sku in
      select distinct upper(btrim(coalesce(item->>'sku','')))
      from jsonb_array_elements(p_rows) item
      order by 1
    loop
      if v_sku <> '' then
        perform pg_advisory_xact_lock(hashtextextended(
          'product-master:' || p_user_id::text || E'\x1f' || v_sku, 0
        ));
      end if;
    end loop;

    if exists (
      select 1
      from jsonb_array_elements(p_rows) item
      join public.products p
        on p.user_id = p_user_id
       and p.deleted_at is null
       and upper(btrim(coalesce(p.sku,''))) = upper(btrim(coalesce(item->>'sku','')))
       and btrim(coalesce(p.size,'')) = btrim(coalesce(item->>'size',''))
       and btrim(coalesce(p.warehouse,'')) = btrim(coalesce(item->>'warehouse',''))
      where item->>'status' = 'shipping' or p.status = 'shipping'
    ) then
      raise exception '运输中库存不能与现有同仓货号尺码直接合并，请先确认到仓或更换仓库';
    end if;
  end if;
  return public.batch_inbound_products_pre_transit_v15(p_rows,p_user_id,p_batch_id);
end;
$$;

revoke all on function public.batch_inbound_products(jsonb,uuid,text) from public, anon;
grant execute on function public.batch_inbound_products(jsonb,uuid,text) to authenticated;

-- The old path changed `shipping` rows to sold without an outbound ledger row.
create or replace function public.complete_pending_products(p_product_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception '该旧功能已停用：shipping 表示采购运输中；卖出必须使用出库记账';
end;
$$;

revoke all on function public.complete_pending_products(text[]) from public, anon, authenticated;

commit;
