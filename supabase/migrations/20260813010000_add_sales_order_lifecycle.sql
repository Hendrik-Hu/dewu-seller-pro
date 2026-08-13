begin;

create table if not exists public.sales_orders (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  status text not null default 'pending_shipment',
  product_name text not null,
  brand text not null,
  sku text not null,
  size text not null,
  warehouse text not null,
  quantity integer not null,
  unit_sale_price numeric(12,2) not null,
  frozen_unit_cost numeric(12,2) not null,
  frozen_image_url text,
  platform text not null,
  external_order_no text,
  note text,
  fee_snapshot jsonb not null,
  estimated_platform_fee numeric(12,2),
  estimated_net_proceeds numeric(12,2),
  estimated_net_profit numeric(12,2),
  outbound_activity_id text unique,
  inventory_restored boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  shipped_at timestamptz,
  authentication_started_at timestamptz,
  authenticated_at timestamptz,
  settled_at timestamptz,
  canceled_at timestamptz,
  return_started_at timestamptz,
  returned_at timestamptz,
  refunded_at timestamptz,
  constraint sales_orders_status_check check (status in (
    'pending_shipment','shipped','authenticating','authenticated','settled',
    'canceled','auth_failed','returning','returned','refunded'
  )),
  constraint sales_orders_quantity_check check (quantity between 1 and 1000),
  constraint sales_orders_price_check check (unit_sale_price between 0 and 1000000),
  constraint sales_orders_cost_check check (frozen_unit_cost between 0 and 1000000),
  constraint sales_orders_version_check check (version > 0),
  constraint sales_orders_identity_lengths_check check (
    char_length(product_id) between 1 and 200
    and char_length(product_name) between 1 and 160
    and char_length(brand) between 1 and 80
    and char_length(sku) between 1 and 120
    and char_length(size) between 1 and 40
    and char_length(warehouse) between 1 and 60
    and char_length(platform) between 1 and 60
    and char_length(coalesce(external_order_no, '')) <= 120
    and char_length(coalesce(note, '')) <= 500
    and char_length(coalesce(frozen_image_url, '')) <= 500
  )
);

create table if not exists public.sales_order_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.sales_orders(id) on delete cascade,
  operation_id text not null,
  payload_fingerprint text not null,
  action text not null,
  from_status text,
  to_status text not null,
  details jsonb not null default '{}'::jsonb,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, operation_id),
  constraint sales_order_events_operation_length_check check (char_length(operation_id) between 8 and 120),
  constraint sales_order_events_fingerprint_check check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint sales_order_events_action_check check (action in (
    'create','ship','start_authentication','pass_authentication','fail_authentication',
    'settle','cancel','start_return','confirm_return','complete_refund'
  )),
  constraint sales_order_events_status_check check (
    (from_status is null or from_status in (
      'pending_shipment','shipped','authenticating','authenticated','settled',
      'canceled','auth_failed','returning','returned','refunded'
    )) and to_status in (
      'pending_shipment','shipped','authenticating','authenticated','settled',
      'canceled','auth_failed','returning','returned','refunded'
    )
  )
);

create index if not exists sales_orders_user_status_created_idx
  on public.sales_orders (user_id, status, created_at desc, id desc);
create index if not exists sales_orders_user_sku_idx
  on public.sales_orders (user_id, upper(trim(sku)), created_at desc);
create index if not exists sales_order_events_order_created_idx
  on public.sales_order_events (user_id, order_id, created_at, id);

alter table public.activities add column if not exists sales_order_id uuid references public.sales_orders(id) on delete set null;
create unique index if not exists activities_sales_order_outbound_unique
  on public.activities (user_id, sales_order_id)
  where sales_order_id is not null and type = 'outbound';

alter table public.sales_orders enable row level security;
alter table public.sales_order_events enable row level security;

drop policy if exists sales_orders_select_own on public.sales_orders;
create policy sales_orders_select_own on public.sales_orders
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists sales_order_events_select_own on public.sales_order_events;
create policy sales_order_events_select_own on public.sales_order_events
  for select to authenticated using (auth.uid() = user_id);

revoke all on table public.sales_orders, public.sales_order_events from public, anon, authenticated;
grant select on table public.sales_orders, public.sales_order_events to authenticated;

create or replace function public.create_sales_order(
  p_user_id uuid,
  p_product_id text,
  p_quantity integer,
  p_unit_sale_price numeric,
  p_platform text,
  p_operation_id text,
  p_fee_scheme_id uuid default null,
  p_fee_scheme_updated_at timestamptz default null,
  p_manual_fee_override numeric default null,
  p_external_order_no text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_product public.products%rowtype;
  v_scheme public.fee_schemes%rowtype;
  v_payload jsonb;
  v_fingerprint text;
  v_existing public.sales_order_events%rowtype;
  v_sale_price numeric(12,2);
  v_manual_fee numeric(12,2);
  v_platform text := coalesce(nullif(btrim(p_platform), ''), '得物');
  v_order_no text := nullif(btrim(p_external_order_no), '');
  v_note text := nullif(btrim(p_note), '');
  v_gross numeric(12,2);
  v_percentage_calculated numeric(12,2) := 0;
  v_percentage_applied numeric(12,2) := 0;
  v_fixed_fee numeric(12,2) := 0;
  v_shipping_fee numeric(12,2) := 0;
  v_other_fee numeric(12,2) := 0;
  v_calculated_fee numeric(12,2);
  v_total_fee numeric(12,2);
  v_net_proceeds numeric(12,2);
  v_net_profit numeric(12,2);
  v_fee_snapshot jsonb;
  v_new_stock integer;
  v_order_id uuid;
  v_result jsonb;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if char_length(btrim(coalesce(p_product_id, ''))) not between 1 and 200 then raise exception 'Product is required'; end if;
  if char_length(btrim(coalesce(p_operation_id, ''))) not between 8 and 120 then raise exception 'Invalid operation id'; end if;
  if p_quantity is null or p_quantity not between 1 and 1000 then raise exception 'Quantity must be between 1 and 1000'; end if;
  if char_length(v_platform) > 60 then raise exception 'Platform is too long'; end if;
  if char_length(coalesce(v_order_no, '')) > 120 then raise exception 'Order number is too long'; end if;
  if char_length(coalesce(v_note, '')) > 500 then raise exception 'Order note is too long'; end if;

  v_sale_price := round(p_unit_sale_price, 2);
  v_manual_fee := case when p_manual_fee_override is null then null else round(p_manual_fee_override, 2) end;
  if v_sale_price is null or v_sale_price < 0 or v_sale_price > 1000000 then raise exception 'Sale price is outside the allowed range'; end if;
  if v_manual_fee is not null and (v_manual_fee < 0 or v_manual_fee > 1000000) then raise exception 'Manual fee is outside the allowed range'; end if;
  if v_sale_price * p_quantity > 9999999999.99 then raise exception 'Gross amount is outside the allowed range'; end if;

  v_payload := jsonb_build_object(
    'productId',btrim(p_product_id),'quantity',p_quantity,'unitSalePrice',v_sale_price,
    'platform',v_platform,'feeSchemeId',p_fee_scheme_id,'feeSchemeUpdatedAt',p_fee_scheme_updated_at,
    'manualFeeOverride',v_manual_fee,'externalOrderNo',v_order_no,'note',v_note
  );
  v_fingerprint := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('sales-order-operation:' || p_user_id::text || ':' || p_operation_id, 0));

  select * into v_existing from public.sales_order_events
  where user_id = p_user_id and operation_id = p_operation_id;
  if found then
    if v_existing.payload_fingerprint is distinct from v_fingerprint then raise exception 'Operation id was already used for different data'; end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_product from public.products
  where id = btrim(p_product_id) and user_id = p_user_id and deleted_at is null and status = 'instock';
  if not found then raise exception 'Active in-stock product not found'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_user_id::text || E'\x1f' || upper(trim(v_product.sku)) || E'\x1f'
      || trim(v_product.size) || E'\x1f' || trim(v_product.warehouse), 0
  ));
  select * into v_product from public.products
  where id = btrim(p_product_id) and user_id = p_user_id and deleted_at is null and status = 'instock'
  for update;
  if not found then raise exception 'Inventory changed; refresh before creating the order'; end if;
  if coalesce(v_product.stock, 0) < p_quantity then raise exception 'Insufficient stock'; end if;
  if v_product.price is null or v_product.price < 0 or v_product.price > 1000000 then
    raise exception 'Product cost is unavailable; correct the cost before creating an order';
  end if;

  v_gross := round(v_sale_price * p_quantity, 2);
  if p_fee_scheme_id is not null then
    select * into v_scheme from public.fee_schemes
    where id = p_fee_scheme_id and user_id = p_user_id and effective_from <= now()
    for share;
    if not found then raise exception 'Fee scheme not found or not yet effective'; end if;
    if p_fee_scheme_updated_at is null or v_scheme.updated_at is distinct from p_fee_scheme_updated_at then
      raise exception 'Fee scheme changed; refresh the quote before creating the order';
    end if;
    if v_scheme.percentage_unit = 'item' then
      v_percentage_calculated := round(round(v_sale_price * v_scheme.percent_rate / 100, 2) * p_quantity, 2);
      v_percentage_applied := round((case
        when v_scheme.percent_min is not null and round(v_sale_price * v_scheme.percent_rate / 100, 2) < v_scheme.percent_min then v_scheme.percent_min
        when v_scheme.percent_max is not null and round(v_sale_price * v_scheme.percent_rate / 100, 2) > v_scheme.percent_max then v_scheme.percent_max
        else round(v_sale_price * v_scheme.percent_rate / 100, 2) end) * p_quantity, 2);
    else
      v_percentage_calculated := round(v_gross * v_scheme.percent_rate / 100, 2);
      v_percentage_applied := case
        when v_scheme.percent_min is not null and v_percentage_calculated < v_scheme.percent_min then v_scheme.percent_min
        when v_scheme.percent_max is not null and v_percentage_calculated > v_scheme.percent_max then v_scheme.percent_max
        else v_percentage_calculated end;
    end if;
    v_fixed_fee := round(v_scheme.fixed_fee * case when v_scheme.fixed_fee_unit = 'item' then p_quantity else 1 end, 2);
    v_shipping_fee := round(v_scheme.shipping_fee * case when v_scheme.shipping_fee_unit = 'item' then p_quantity else 1 end, 2);
    v_other_fee := round(v_scheme.other_fee * case when v_scheme.other_fee_unit = 'item' then p_quantity else 1 end, 2);
    v_calculated_fee := round(v_percentage_applied + v_fixed_fee + v_shipping_fee + v_other_fee, 2);
    v_total_fee := coalesce(v_manual_fee, v_calculated_fee);
    v_fee_snapshot := jsonb_build_object(
      'schemaVersion','fee-snapshot@1','status','known','schemeId',v_scheme.id,'schemeName',v_scheme.name,
      'schemeUpdatedAt',v_scheme.updated_at,'saleMode',v_scheme.sale_mode,'category',v_scheme.category,
      'percentRate',v_scheme.percent_rate,'percentMin',v_scheme.percent_min,'percentMax',v_scheme.percent_max,
      'percentageUnit',v_scheme.percentage_unit,'percentageCalculated',v_percentage_calculated,'percentageApplied',v_percentage_applied,
      'fixedFee',v_scheme.fixed_fee,'fixedFeeUnit',v_scheme.fixed_fee_unit,'fixedFeeApplied',v_fixed_fee,
      'shippingFee',v_scheme.shipping_fee,'shippingFeeUnit',v_scheme.shipping_fee_unit,'shippingFeeApplied',v_shipping_fee,
      'otherFee',v_scheme.other_fee,'otherFeeUnit',v_scheme.other_fee_unit,'otherFeeApplied',v_other_fee,
      'calculatedTotal',v_calculated_fee,'manualOverride',v_manual_fee,'total',v_total_fee,
      'quantity',p_quantity,'grossAmount',v_gross,'capturedAt',now()
    );
  elsif v_manual_fee is not null then
    v_total_fee := v_manual_fee;
    v_fee_snapshot := jsonb_build_object(
      'schemaVersion','fee-snapshot@1','status','known','source','manual','manualOverride',v_total_fee,
      'total',v_total_fee,'quantity',p_quantity,'grossAmount',v_gross,'capturedAt',now()
    );
  else
    v_total_fee := null;
    v_fee_snapshot := jsonb_build_object(
      'schemaVersion','fee-snapshot@1','status','unknown','reason','NO_FEE_SCHEME',
      'quantity',p_quantity,'grossAmount',v_gross,'capturedAt',now()
    );
  end if;
  if v_total_fee is not null then
    v_net_proceeds := round(v_gross - v_total_fee, 2);
    v_net_profit := round(v_net_proceeds - round(v_product.price * p_quantity, 2), 2);
  end if;

  v_new_stock := v_product.stock - p_quantity;
  update public.products set stock = v_new_stock, status = case when v_new_stock = 0 then 'sold' else 'instock' end
  where id = v_product.id and user_id = p_user_id;

  v_order_id := (
    substr(encode(extensions.digest(convert_to('sales-order:' || p_user_id::text || ':' || p_operation_id, 'UTF8'), 'sha256'), 'hex'),1,8) || '-' ||
    substr(encode(extensions.digest(convert_to('sales-order:' || p_user_id::text || ':' || p_operation_id, 'UTF8'), 'sha256'), 'hex'),9,4) || '-' ||
    substr(encode(extensions.digest(convert_to('sales-order:' || p_user_id::text || ':' || p_operation_id, 'UTF8'), 'sha256'), 'hex'),13,4) || '-' ||
    substr(encode(extensions.digest(convert_to('sales-order:' || p_user_id::text || ':' || p_operation_id, 'UTF8'), 'sha256'), 'hex'),17,4) || '-' ||
    substr(encode(extensions.digest(convert_to('sales-order:' || p_user_id::text || ':' || p_operation_id, 'UTF8'), 'sha256'), 'hex'),21,12)
  )::uuid;
  insert into public.sales_orders (
    id,user_id,product_id,status,product_name,brand,sku,size,warehouse,quantity,unit_sale_price,
    frozen_unit_cost,frozen_image_url,platform,external_order_no,note,fee_snapshot,
    estimated_platform_fee,estimated_net_proceeds,estimated_net_profit
  ) values (
    v_order_id,p_user_id,v_product.id,'pending_shipment',v_product.name,
    coalesce(nullif(btrim(v_product.brand),''),'未知品牌'),upper(btrim(v_product.sku)),btrim(v_product.size),
    btrim(v_product.warehouse),p_quantity,v_sale_price,v_product.price,v_product.image_url,v_platform,v_order_no,v_note,
    v_fee_snapshot,v_total_fee,v_net_proceeds,v_net_profit
  );
  v_result := jsonb_build_object(
    'orderId',v_order_id,'status','pending_shipment','productId',v_product.id,'stock',v_new_stock,
    'quantity',p_quantity,'grossAmount',v_gross,'estimatedPlatformFee',v_total_fee,
    'estimatedNetProceeds',v_net_proceeds,'estimatedNetProfit',v_net_profit,'feeSnapshot',v_fee_snapshot,'replayed',false
  );
  insert into public.sales_order_events(user_id,order_id,operation_id,payload_fingerprint,action,from_status,to_status,details,result)
  values (p_user_id,v_order_id,p_operation_id,v_fingerprint,'create',null,'pending_shipment',v_payload,v_result);
  return v_result;
end;
$$;

create or replace function public.transition_sales_order(
  p_user_id uuid,
  p_order_id uuid,
  p_action text,
  p_expected_status text,
  p_expected_version integer,
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_order public.sales_orders%rowtype;
  v_product public.products%rowtype;
  v_existing public.sales_order_events%rowtype;
  v_payload jsonb;
  v_fingerprint text;
  v_to_status text;
  v_activity_id text;
  v_restore_activity_id text;
  v_result jsonb;
  v_new_stock integer;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if p_order_id is null then raise exception 'Order is required'; end if;
  if p_action not in ('ship','start_authentication','pass_authentication','fail_authentication','settle','cancel','start_return','confirm_return','complete_refund') then raise exception 'Unsupported order action'; end if;
  if char_length(btrim(coalesce(p_operation_id,''))) not between 8 and 120 then raise exception 'Invalid operation id'; end if;
  if p_expected_version is null or p_expected_version <= 0 then raise exception 'Expected version is required'; end if;
  v_payload := jsonb_build_object('orderId',p_order_id,'action',p_action,'expectedStatus',p_expected_status,'expectedVersion',p_expected_version);
  v_fingerprint := encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('sales-order-operation:' || p_user_id::text || ':' || p_operation_id,0));
  select * into v_existing from public.sales_order_events where user_id=p_user_id and operation_id=p_operation_id;
  if found then
    if v_existing.payload_fingerprint is distinct from v_fingerprint then raise exception 'Operation id was already used for different data'; end if;
    return v_existing.result || jsonb_build_object('replayed',true);
  end if;
  select * into v_order from public.sales_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if v_order.status is distinct from p_expected_status or v_order.version is distinct from p_expected_version then
    raise exception 'Order changed; refresh before continuing';
  end if;

  v_to_status := case
    when p_action='ship' and v_order.status='pending_shipment' then 'shipped'
    when p_action='cancel' and v_order.status='pending_shipment' then 'canceled'
    when p_action='start_authentication' and v_order.status='shipped' then 'authenticating'
    when p_action='pass_authentication' and v_order.status in ('shipped','authenticating') then 'authenticated'
    when p_action='fail_authentication' and v_order.status='authenticating' then 'auth_failed'
    when p_action='settle' and v_order.status='authenticated' then 'settled'
    when p_action='start_return' and v_order.status in ('settled','auth_failed') then 'returning'
    when p_action='confirm_return' and v_order.status='returning' then 'returned'
    when p_action='complete_refund' and v_order.status='returned' then 'refunded'
    else null end;
  if v_to_status is null then raise exception 'Action is not allowed for the current order status'; end if;

  if p_action='ship' then
    if v_order.outbound_activity_id is not null then raise exception 'Order shipment was already recorded'; end if;
    v_activity_id := 'act-order-' || replace(v_order.id::text,'-','');
    insert into public.activities (
      id,type,product_name,time,sku,size,price,cost,image_url,created_at,warehouse,count,user_id,platform,
      fee_snapshot,estimated_platform_fee,estimated_net_proceeds,estimated_net_profit,sales_order_id,source
    ) values (
      v_activity_id,'outbound',v_order.product_name,'刚刚',v_order.sku,v_order.size,v_order.unit_sale_price,
      v_order.frozen_unit_cost,v_order.frozen_image_url,now(),v_order.warehouse,v_order.quantity,p_user_id,v_order.platform,
      v_order.fee_snapshot,v_order.estimated_platform_fee,v_order.estimated_net_proceeds,v_order.estimated_net_profit,
      v_order.id,coalesce(v_order.external_order_no,'销售订单')
    );
  elsif p_action in ('cancel','confirm_return') then
    if v_order.inventory_restored then raise exception 'Order inventory was already restored'; end if;
    perform pg_advisory_xact_lock(hashtextextended(
      p_user_id::text || E'\x1f' || upper(trim(v_order.sku)) || E'\x1f'
        || trim(v_order.size) || E'\x1f' || trim(v_order.warehouse),0
    ));
    select * into v_product from public.products
    where id=v_order.product_id and user_id=p_user_id and deleted_at is null for update;
    if not found then raise exception 'Reserved inventory record is unavailable; resolve it before restoring'; end if;
    if upper(trim(v_product.sku)) is distinct from upper(trim(v_order.sku))
      or trim(v_product.size) is distinct from trim(v_order.size)
      or trim(v_product.warehouse) is distinct from trim(v_order.warehouse) then
      raise exception 'Reserved inventory identity changed; resolve it before restoring';
    end if;
    v_new_stock := coalesce(v_product.stock,0) + v_order.quantity;
    update public.products set stock=v_new_stock,
      status=case when status='sold' then 'instock' else status end
    where id=v_product.id and user_id=p_user_id;
    v_restore_activity_id := 'act-order-restore-' || replace(v_order.id::text,'-','');
    insert into public.activities(id,type,product_name,time,sku,size,price,cost,image_url,created_at,warehouse,count,user_id,platform,source)
    values (v_restore_activity_id,'restore',v_order.product_name,'刚刚',v_order.sku,v_order.size,v_order.frozen_unit_cost,
      v_order.frozen_unit_cost,v_order.frozen_image_url,now(),v_order.warehouse,v_order.quantity,p_user_id,
      '销售订单',case when p_action='cancel' then '订单取消恢复' else '退回收货恢复' end);
  end if;

  if p_action='settle' then
    if v_order.outbound_activity_id is null then raise exception 'Order has no outbound activity'; end if;
    if not exists (
      select 1 from public.activities where id=v_order.outbound_activity_id and user_id=p_user_id
        and type='outbound' and coalesce(settlement_revision,0)>0
    ) then raise exception 'Record the actual settlement before completing the order'; end if;
  end if;
  if p_action='complete_refund' and v_order.settled_at is null then raise exception 'Only settled returns can be marked refunded'; end if;

  update public.sales_orders set
    status=v_to_status,
    outbound_activity_id=case when p_action='ship' then v_activity_id else outbound_activity_id end,
    inventory_restored=case when p_action in ('cancel','confirm_return') then true else inventory_restored end,
    version=version+1,updated_at=now(),
    shipped_at=case when p_action='ship' then now() else shipped_at end,
    authentication_started_at=case when p_action='start_authentication' then now() else authentication_started_at end,
    authenticated_at=case when p_action='pass_authentication' then now() else authenticated_at end,
    settled_at=case when p_action='settle' then now() else settled_at end,
    canceled_at=case when p_action='cancel' then now() else canceled_at end,
    return_started_at=case when p_action='start_return' then now() else return_started_at end,
    returned_at=case when p_action='confirm_return' then now() else returned_at end,
    refunded_at=case when p_action='complete_refund' then now() else refunded_at end
  where id=v_order.id and user_id=p_user_id;
  v_result := jsonb_build_object(
    'orderId',v_order.id,'status',v_to_status,'version',v_order.version+1,'action',p_action,
    'outboundActivityId',coalesce(v_activity_id,v_order.outbound_activity_id),
    'inventoryRestored',v_order.inventory_restored or p_action in ('cancel','confirm_return'),
    'stock',v_new_stock,'replayed',false
  );
  insert into public.sales_order_events(user_id,order_id,operation_id,payload_fingerprint,action,from_status,to_status,details,result)
  values (p_user_id,v_order.id,p_operation_id,v_fingerprint,p_action,v_order.status,v_to_status,'{}'::jsonb,v_result);
  return v_result;
end;
$$;

create or replace function public.guard_open_sales_order_product_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null and exists (
    select 1 from public.sales_orders
    where user_id=old.user_id and product_id=old.id
      and status not in ('canceled','returned','refunded')
  ) then raise exception 'Product has an active sales order and cannot be moved to recycle bin'; end if;
  return new;
end;
$$;

drop trigger if exists products_guard_open_sales_order_delete on public.products;
create trigger products_guard_open_sales_order_delete
before update of deleted_at on public.products
for each row execute function public.guard_open_sales_order_product_delete();

revoke all on function public.create_sales_order(uuid,text,integer,numeric,text,text,uuid,timestamptz,numeric,text,text) from public, anon;
grant execute on function public.create_sales_order(uuid,text,integer,numeric,text,text,uuid,timestamptz,numeric,text,text) to authenticated;
revoke all on function public.transition_sales_order(uuid,uuid,text,text,integer,text) from public, anon;
grant execute on function public.transition_sales_order(uuid,uuid,text,text,integer,text) to authenticated;
revoke all on function public.guard_open_sales_order_product_delete() from public, anon, authenticated;

commit;
