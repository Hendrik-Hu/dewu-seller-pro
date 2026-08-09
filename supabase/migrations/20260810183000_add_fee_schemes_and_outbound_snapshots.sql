begin;

create table if not exists public.fee_schemes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sale_mode text not null default '',
  category text not null default '',
  percent_rate numeric(8,4) not null default 0,
  percent_min numeric(12,2),
  percent_max numeric(12,2),
  percentage_unit text not null default 'transaction',
  fixed_fee numeric(12,2) not null default 0,
  fixed_fee_unit text not null default 'transaction',
  shipping_fee numeric(12,2) not null default 0,
  shipping_fee_unit text not null default 'transaction',
  other_fee numeric(12,2) not null default 0,
  other_fee_unit text not null default 'transaction',
  effective_from timestamptz not null default now(),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_schemes_name_length check (length(trim(name)) between 1 and 60),
  constraint fee_schemes_text_lengths check (length(sale_mode) <= 60 and length(category) <= 60),
  constraint fee_schemes_rate_range check (percent_rate between 0 and 100),
  constraint fee_schemes_money_nonnegative check (
    (percent_min is null or percent_min >= 0) and
    (percent_max is null or percent_max >= 0) and
    fixed_fee >= 0 and shipping_fee >= 0 and other_fee >= 0
  ),
  constraint fee_schemes_money_upper_bound check (
    (percent_min is null or percent_min <= 1000000) and
    (percent_max is null or percent_max <= 1000000) and
    fixed_fee <= 1000000 and shipping_fee <= 1000000 and other_fee <= 1000000
  ),
  constraint fee_schemes_cap_order check (percent_min is null or percent_max is null or percent_min <= percent_max),
  constraint fee_schemes_units check (
    percentage_unit in ('transaction', 'item') and
    fixed_fee_unit in ('transaction', 'item') and
    shipping_fee_unit in ('transaction', 'item') and
    other_fee_unit in ('transaction', 'item')
  )
);

create index if not exists fee_schemes_user_effective_idx
  on public.fee_schemes(user_id, effective_from desc, created_at desc);
create unique index if not exists fee_schemes_one_default_per_user_idx
  on public.fee_schemes(user_id) where is_default;

alter table public.fee_schemes enable row level security;
drop policy if exists fee_schemes_select_own on public.fee_schemes;
drop policy if exists fee_schemes_insert_own on public.fee_schemes;
drop policy if exists fee_schemes_update_own on public.fee_schemes;
drop policy if exists fee_schemes_delete_own on public.fee_schemes;
create policy fee_schemes_select_own on public.fee_schemes for select to authenticated using (auth.uid() = user_id);
create policy fee_schemes_insert_own on public.fee_schemes for insert to authenticated with check (auth.uid() = user_id);
create policy fee_schemes_update_own on public.fee_schemes for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy fee_schemes_delete_own on public.fee_schemes for delete to authenticated using (auth.uid() = user_id);
revoke all on public.fee_schemes from public, anon;
grant select, insert, update, delete on public.fee_schemes to authenticated;

create or replace function public.normalize_fee_scheme_write()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.name := trim(new.name);
  new.sale_mode := trim(coalesce(new.sale_mode, ''));
  new.category := trim(coalesce(new.category, ''));
  new.updated_at := now();
  if new.is_default then
    update public.fee_schemes set is_default = false, updated_at = now()
    where user_id = new.user_id and id is distinct from new.id and is_default;
  end if;
  return new;
end;
$$;

drop trigger if exists fee_schemes_normalize_write on public.fee_schemes;
create trigger fee_schemes_normalize_write
before insert or update on public.fee_schemes
for each row execute function public.normalize_fee_scheme_write();

alter table public.activities
  add column if not exists fee_snapshot jsonb,
  add column if not exists estimated_platform_fee numeric(12,2),
  add column if not exists estimated_net_proceeds numeric(12,2),
  add column if not exists estimated_net_profit numeric(12,2);

alter table public.activities
  drop constraint if exists activities_estimated_fee_nonnegative;
alter table public.activities
  add constraint activities_estimated_fee_nonnegative
  check (estimated_platform_fee is null or estimated_platform_fee >= 0) not valid;
alter table public.activities validate constraint activities_estimated_fee_nonnegative;

create table if not exists public.outbound_fee_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  payload_fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id),
  constraint outbound_fee_operation_id_length check (length(operation_id) between 8 and 120)
);
alter table public.outbound_fee_operations enable row level security;
revoke all on public.outbound_fee_operations from public, anon, authenticated;

create or replace function public.guard_outbound_fee_snapshot_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.fee_snapshot is distinct from new.fee_snapshot
    or old.estimated_platform_fee is distinct from new.estimated_platform_fee
    or old.estimated_net_proceeds is distinct from new.estimated_net_proceeds
    or old.estimated_net_profit is distinct from new.estimated_net_profit then
    raise exception 'Outbound fee estimate snapshot is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists activities_guard_outbound_fee_snapshot on public.activities;
create trigger activities_guard_outbound_fee_snapshot
before update on public.activities
for each row execute function public.guard_outbound_fee_snapshot_update();

create or replace function public.outbound_product_with_fees(
  p_product_id text,
  p_user_id uuid,
  p_sale_price numeric,
  p_quantity integer,
  p_platform text,
  p_operation_id text,
  p_fee_scheme_id uuid default null,
  p_fee_scheme_updated_at timestamptz default null,
  p_manual_fee_override numeric default null
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
  v_existing_fingerprint text;
  v_existing_result jsonb;
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
  v_activity_id text;
  v_result jsonb;
  v_sale_price numeric(12,2);
  v_manual_fee numeric(12,2);
  v_platform text;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if p_product_id is null or length(trim(p_product_id)) not between 1 and 200 then raise exception 'Product is required'; end if;
  if p_operation_id is null or length(p_operation_id) not between 8 and 120 then raise exception 'Invalid operation id'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000 then raise exception 'Quantity must be between 1 and 1000'; end if;
  v_sale_price := round(p_sale_price, 2);
  v_manual_fee := case when p_manual_fee_override is null then null else round(p_manual_fee_override, 2) end;
  v_platform := coalesce(nullif(trim(p_platform), ''), '得物');
  if v_sale_price is null or v_sale_price < 0 or v_sale_price > 1000000 then raise exception 'Sale price is outside the allowed range'; end if;
  if v_manual_fee is not null and (v_manual_fee < 0 or v_manual_fee > 1000000) then raise exception 'Manual fee is outside the allowed range'; end if;
  if v_sale_price * p_quantity > 9999999999.99 then raise exception 'Gross amount is outside the allowed range'; end if;
  if length(v_platform) > 60 then raise exception 'Platform is too long'; end if;

  v_payload := jsonb_build_object(
    'productId', p_product_id, 'salePrice', v_sale_price, 'quantity', p_quantity,
    'platform', v_platform, 'schemeId', p_fee_scheme_id,
    'schemeUpdatedAt', p_fee_scheme_updated_at, 'manualFeeOverride', v_manual_fee
  );
  v_fingerprint := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('outbound-fee:' || p_user_id::text || ':' || p_operation_id, 0));

  select payload_fingerprint, result into v_existing_fingerprint, v_existing_result
  from public.outbound_fee_operations where user_id = p_user_id and operation_id = p_operation_id;
  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'Operation id was already used for different data'; end if;
    return v_existing_result || jsonb_build_object('replayed', true);
  end if;

  select * into v_product from public.products
  where id = p_product_id and user_id = p_user_id and deleted_at is null and status = 'instock'
  for update;
  if not found then raise exception 'Active in-stock product not found'; end if;
  if coalesce(v_product.stock, 0) < p_quantity then raise exception 'Insufficient stock'; end if;

  v_gross := round(v_sale_price * p_quantity, 2);
  if p_fee_scheme_id is not null then
    select * into v_scheme from public.fee_schemes
    where id = p_fee_scheme_id and user_id = p_user_id and effective_from <= now()
    for share;
    if not found then raise exception 'Fee scheme not found or not yet effective'; end if;
    if p_fee_scheme_updated_at is null or v_scheme.updated_at is distinct from p_fee_scheme_updated_at then
      raise exception 'Fee scheme changed; refresh the quote before outbound';
    end if;

    if v_scheme.percentage_unit = 'item' then
      v_percentage_calculated := round(round(v_sale_price * v_scheme.percent_rate / 100, 2) * p_quantity, 2);
      v_percentage_applied := round((
        case
          when v_scheme.percent_min is not null and round(v_sale_price * v_scheme.percent_rate / 100, 2) < v_scheme.percent_min then v_scheme.percent_min
          when v_scheme.percent_max is not null and round(v_sale_price * v_scheme.percent_rate / 100, 2) > v_scheme.percent_max then v_scheme.percent_max
          else round(v_sale_price * v_scheme.percent_rate / 100, 2)
        end
      ) * p_quantity, 2);
    else
      v_percentage_calculated := round(v_gross * v_scheme.percent_rate / 100, 2);
      v_percentage_applied := case
        when v_scheme.percent_min is not null and v_percentage_calculated < v_scheme.percent_min then v_scheme.percent_min
        when v_scheme.percent_max is not null and v_percentage_calculated > v_scheme.percent_max then v_scheme.percent_max
        else v_percentage_calculated
      end;
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
      'calculatedTotal',v_calculated_fee,'manualOverride',v_manual_fee,
      'total',v_total_fee,'quantity',p_quantity,'grossAmount',v_gross,'capturedAt',now()
    );
  elsif v_manual_fee is not null then
    v_calculated_fee := 0;
    v_total_fee := v_manual_fee;
    v_fee_snapshot := jsonb_build_object(
      'schemaVersion','fee-snapshot@1','status','known','source','manual','manualOverride',v_total_fee,
      'total',v_total_fee,'quantity',p_quantity,'grossAmount',v_gross,'capturedAt',now()
    );
  else
    v_calculated_fee := null;
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
  where id = p_product_id and user_id = p_user_id and deleted_at is null and status = 'instock';

  v_activity_id := 'act-fee-' || substr(encode(extensions.digest(convert_to(p_user_id::text || ':' || p_operation_id, 'UTF8'), 'sha256'), 'hex'), 1, 32);
  insert into public.activities (
    id,type,product_name,time,sku,size,price,cost,image_url,created_at,warehouse,count,user_id,platform,
    fee_snapshot,estimated_platform_fee,estimated_net_proceeds,estimated_net_profit
  ) values (
    v_activity_id,'outbound',v_product.name,'刚刚',v_product.sku,v_product.size,v_sale_price,v_product.price,
    v_product.image_url,now(),v_product.warehouse,p_quantity,p_user_id,v_platform,
    v_fee_snapshot,v_total_fee,v_net_proceeds,v_net_profit
  );

  v_result := jsonb_build_object(
    'product_id',p_product_id,'activity_id',v_activity_id,'stock',v_new_stock,'gross_amount',v_gross,
    'estimated_platform_fee',v_total_fee,'estimated_net_proceeds',v_net_proceeds,'estimated_net_profit',v_net_profit,
    'fee_snapshot',v_fee_snapshot,'replayed',false
  );
  insert into public.outbound_fee_operations(user_id,operation_id,payload_fingerprint,result)
  values (p_user_id,p_operation_id,v_fingerprint,v_result);
  return v_result;
end;
$$;

revoke all on function public.outbound_product_with_fees(text,uuid,numeric,integer,text,text,uuid,timestamptz,numeric) from public, anon;
grant execute on function public.outbound_product_with_fees(text,uuid,numeric,integer,text,text,uuid,timestamptz,numeric) to authenticated;

commit;
