create or replace function public.get_inventory_analytics(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_local_today date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_rolling_start timestamptz;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;
  if p_as_of is null then
    raise exception 'Reference time is required';
  end if;

  v_local_today := (p_as_of at time zone 'Asia/Shanghai')::date;
  v_day_start := v_local_today::timestamp at time zone 'Asia/Shanghai';
  v_day_end := (v_local_today + 1)::timestamp at time zone 'Asia/Shanghai';
  v_month_start := date_trunc('month', p_as_of at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai';
  v_month_end := (date_trunc('month', p_as_of at time zone 'Asia/Shanghai') + interval '1 month') at time zone 'Asia/Shanghai';
  v_rolling_start := (v_local_today - 29)::timestamp at time zone 'Asia/Shanghai';

  with product_base as (
    select
      p.*,
      upper(btrim(coalesce(p.sku, ''))) as normalized_sku,
      coalesce(nullif(btrim(p.brand), ''), '未知品牌') as normalized_brand
    from public.products p
    where p.user_id = v_user
      and p.deleted_at is null
  ),
  product_totals as (
    select
      coalesce(sum(stock) filter (where status = 'instock' and stock >= 0), 0)::numeric as total_stock,
      coalesce(sum(price * stock) filter (where status = 'instock' and stock >= 0), 0)::numeric as total_inventory_value,
      count(distinct nullif(normalized_sku, '')) filter (where status = 'instock' and stock >= 0)::integer as total_sku_count,
      count(*) filter (where status = 'instock' and stock >= 0)::integer as total_variant_count,
      count(*) filter (where status = 'shipping')::integer as pending_order_count,
      count(*) filter (where stock < 0)::integer as negative_stock_count
    from product_base
  ),
  activity_base as (
    select
      a.*,
      case when a.count is null then 1 when a.count > 0 then a.count else 0 end::numeric as quantity,
      coalesce(a.price, 0) * (case when a.count is null then 1 when a.count > 0 then a.count else 0 end)::numeric as gross_amount,
      coalesce(a.cost, 0) * (case when a.count is null then 1 when a.count > 0 then a.count else 0 end)::numeric as cost_amount,
      (a.cost is not null and a.cost >= 0) as has_cost,
      (a.created_at at time zone 'Asia/Shanghai')::date as local_day,
      upper(btrim(coalesce(a.sku, ''))) as normalized_sku
    from public.activities a
    where a.user_id = v_user
  ),
  activity_totals as (
    select
      coalesce(sum(quantity) filter (where type = 'inbound'), 0)::numeric as total_inbound_count,
      coalesce(sum(quantity) filter (where type = 'outbound'), 0)::numeric as total_outbound_count,
      count(*) filter (where count is not null and count <= 0)::integer as invalid_activity_count,
      coalesce(sum(gross_amount) filter (where type = 'outbound' and created_at >= v_day_start and created_at < v_day_end), 0)::numeric as today_sales_amount,
      coalesce(sum(quantity) filter (where type = 'outbound' and created_at >= v_day_start and created_at < v_day_end), 0)::numeric as today_sales_count,
      coalesce(sum(quantity) filter (where type = 'inbound' and created_at >= v_day_start and created_at < v_day_end), 0)::numeric as today_inbound_count,
      coalesce(sum(gross_amount) filter (where type = 'outbound' and created_at >= v_month_start and created_at < v_month_end), 0)::numeric as month_sales_amount,
      coalesce(sum(gross_amount) filter (where type = 'outbound' and has_cost and created_at >= v_month_start and created_at < v_month_end), 0)::numeric as month_costed_sales_amount,
      coalesce(sum(cost_amount) filter (where type = 'outbound' and has_cost and created_at >= v_month_start and created_at < v_month_end), 0)::numeric as month_cost_amount,
      coalesce(sum(quantity) filter (where type = 'inbound' and created_at >= v_month_start and created_at < v_month_end), 0)::numeric as month_inbound_count,
      coalesce(sum(quantity) filter (where type = 'outbound' and created_at >= v_month_start and created_at < v_month_end), 0)::numeric as month_outbound_count,
      coalesce(sum(quantity) filter (where type = 'outbound' and has_cost and created_at >= v_month_start and created_at < v_month_end), 0)::numeric as month_costed_outbound_count,
      coalesce(sum(estimated_net_profit) filter (where type = 'outbound' and has_cost and estimated_net_profit is not null and created_at >= v_month_start and created_at < v_month_end), 0)::numeric as month_estimated_net_profit,
      coalesce(sum(quantity) filter (where type = 'outbound' and has_cost and estimated_net_profit is not null and created_at >= v_month_start and created_at < v_month_end), 0)::numeric as month_estimated_profit_count,
      coalesce(sum(actual_net_profit) filter (where type = 'outbound' and has_cost and actual_net_profit is not null and created_at >= v_month_start and created_at < v_month_end), 0)::numeric as month_actual_net_profit,
      coalesce(sum(quantity) filter (where type = 'outbound' and has_cost and actual_net_profit is not null and created_at >= v_month_start and created_at < v_month_end), 0)::numeric as month_actual_profit_count,
      coalesce(sum(quantity) filter (where type = 'outbound' and actual_platform_fee is not null and created_at >= v_month_start and created_at < v_month_end), 0)::numeric as month_settled_count
    from activity_base
  )
  select jsonb_build_object(
    'dataQuality', jsonb_build_object(
      'negativeStockCount', pt.negative_stock_count,
      'invalidActivityCount', at.invalid_activity_count
    ),
    'dashboard', jsonb_build_object(
      'pendingOrderCount', pt.pending_order_count,
      'totalSkuCount', pt.total_sku_count,
      'totalVariantCount', pt.total_variant_count,
      'todaySalesAmount', at.today_sales_amount,
      'todaySalesCount', at.today_sales_count,
      'todayInboundCount', at.today_inbound_count,
      'totalStock', pt.total_stock,
      'totalInventoryValue', pt.total_inventory_value
    ),
    'lifetime', jsonb_build_object(
      'totalInboundCount', at.total_inbound_count,
      'totalOutboundCount', at.total_outbound_count
    ),
    'monthly', jsonb_build_object(
      'salesAmount', at.month_sales_amount,
      'costedSalesAmount', at.month_costed_sales_amount,
      'costAmount', at.month_cost_amount,
      'grossProfitAmount', at.month_costed_sales_amount - at.month_cost_amount,
      'grossMarginRate', case when at.month_costed_sales_amount > 0 then ((at.month_costed_sales_amount - at.month_cost_amount) / at.month_costed_sales_amount) * 100 else 0 end,
      'costCoverageRate', case when at.month_outbound_count > 0 then (at.month_costed_outbound_count / at.month_outbound_count) * 100 else 100 end,
      'missingCostCount', greatest(0, at.month_outbound_count - at.month_costed_outbound_count),
      'costedOutboundCount', at.month_costed_outbound_count,
      'estimatedNetProfitAmount', at.month_estimated_net_profit,
      'estimatedProfitCount', at.month_estimated_profit_count,
      'estimatedProfitCoverageRate', case when at.month_costed_outbound_count > 0 then (at.month_estimated_profit_count / at.month_costed_outbound_count) * 100 else 100 end,
      'actualNetProfitAmount', at.month_actual_net_profit,
      'actualProfitCount', at.month_actual_profit_count,
      'actualProfitCoverageRate', case when at.month_costed_outbound_count > 0 then (at.month_actual_profit_count / at.month_costed_outbound_count) * 100 else 100 end,
      'settlementCoverageRate', case when at.month_outbound_count > 0 then (at.month_settled_count / at.month_outbound_count) * 100 else 100 end,
      'pendingSettlementCount', greatest(0, at.month_outbound_count - at.month_settled_count),
      'inboundCount', at.month_inbound_count,
      'outboundCount', at.month_outbound_count
    ),
    'charts', jsonb_build_object(
      'salesTrend', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', extract(month from days.day)::integer || '/' || extract(day from days.day)::integer,
          'value', coalesce(sales.amount, 0)
        ) order by days.day)
        from generate_series(v_local_today - 29, v_local_today, interval '1 day') as days(day)
        left join (
          select local_day, sum(gross_amount)::numeric as amount
          from activity_base
          where type = 'outbound' and created_at >= v_rolling_start and created_at < v_day_end
          group by local_day
        ) sales on sales.local_day = days.day::date
      ), '[]'::jsonb),
      'topBrands', coalesce((
        select jsonb_agg(jsonb_build_object('name', ranked.name, 'value', ranked.value) order by ranked.value desc, ranked.name)
        from (
          select normalized_brand as name, sum(stock)::numeric as value
          from product_base
          where status = 'instock' and stock >= 0
          group by normalized_brand
          order by value desc, name
          limit 5
        ) ranked
      ), '[]'::jsonb),
      'topProducts', coalesce((
        select jsonb_agg(jsonb_build_object('name', ranked.name, 'sku', ranked.sku, 'sold', ranked.sold) order by ranked.sold desc, ranked.sku)
        from (
          select
            coalesce(nullif(normalized_sku, ''), '(无货号)') as sku,
            (array_agg(coalesce(nullif(btrim(product_name), ''), coalesce(nullif(normalized_sku, ''), '未命名商品')) order by created_at desc, id desc))[1] as name,
            sum(quantity)::numeric as sold
          from activity_base
          where type = 'outbound'
          group by coalesce(nullif(normalized_sku, ''), '(无货号)')
          order by sold desc, sku
          limit 5
        ) ranked
      ), '[]'::jsonb),
      'topStockProducts', coalesce((
        select jsonb_agg(jsonb_build_object('name', ranked.name, 'sku', ranked.sku, 'stock', ranked.stock) order by ranked.stock desc, ranked.sku)
        from (
          select
            coalesce(nullif(normalized_sku, ''), id::text) as sku,
            (array_agg(name order by created_at desc, id desc))[1] as name,
            sum(stock)::numeric as stock
          from product_base
          where status = 'instock' and stock >= 0
          group by coalesce(nullif(normalized_sku, ''), id::text)
          order by stock desc, sku
          limit 5
        ) ranked
      ), '[]'::jsonb)
    ),
    'pendingProducts', '[]'::jsonb
  ) into v_result
  from product_totals pt cross join activity_totals at;

  return v_result;
end;
$$;

create or replace function public.get_inventory_warehouse_summary(
  p_warehouse text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_warehouse text := btrim(coalesce(p_warehouse, ''));
  v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if v_warehouse = '' or char_length(v_warehouse) > 60 then raise exception 'Warehouse is invalid'; end if;
  if not exists (select 1 from public.warehouses where user_id = v_user and name = v_warehouse) then
    raise exception 'Warehouse does not exist';
  end if;

  select jsonb_build_object(
    'totalCount', coalesce(sum(stock) filter (where status = 'instock' and stock >= 0), 0),
    'totalValue', coalesce(sum(price * stock) filter (where status = 'instock' and stock >= 0), 0),
    'warehouseCount', coalesce(sum(stock) filter (where status = 'instock' and stock >= 0 and warehouse = v_warehouse), 0),
    'warehouseValue', coalesce(sum(price * stock) filter (where status = 'instock' and stock >= 0 and warehouse = v_warehouse), 0)
  ) into v_result
  from public.products
  where user_id = v_user and deleted_at is null;

  return v_result;
end;
$$;

revoke all on function public.get_inventory_analytics(timestamptz) from public, anon;
revoke all on function public.get_inventory_warehouse_summary(text) from public, anon;
grant execute on function public.get_inventory_analytics(timestamptz) to authenticated;
grant execute on function public.get_inventory_warehouse_summary(text) to authenticated;

create or replace function public.search_inventory_groups(
  p_warehouse text,
  p_status text default null,
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_warehouse text := btrim(coalesce(p_warehouse, ''));
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if v_warehouse = '' or char_length(v_warehouse) > 60 then raise exception 'Warehouse is invalid'; end if;
  if v_search = '' or char_length(v_search) > 100 then raise exception 'Search text is invalid'; end if;
  if p_page < 1 or p_page > 100000 or p_page_size < 1 or p_page_size > 30 then raise exception 'Search page is invalid'; end if;
  if v_status is not null and v_status not in ('instock', 'shipping', 'sold', 'flaw') then raise exception 'Status is invalid'; end if;
  if not exists (select 1 from public.warehouses where user_id = v_user and name = v_warehouse) then
    raise exception 'Warehouse does not exist';
  end if;

  with filtered as (
    select
      p.*,
      coalesce(
        nullif(upper(btrim(coalesce(p.sku, ''))), ''),
        upper(btrim(coalesce(p.brand, ''))) || '__' || upper(btrim(coalesce(p.name, '')))
      ) as group_key
    from public.products p
    where p.user_id = v_user
      and p.deleted_at is null
      and p.stock >= 0
      and p.warehouse = v_warehouse
      and (v_status is null or p.status = v_status)
      and (
        strpos(lower(coalesce(p.name, '')), v_search) > 0
        or strpos(lower(coalesce(p.sku, '')), v_search) > 0
        or strpos(lower(coalesce(p.brand, '')), v_search) > 0
      )
  ),
  grouped as (
    select group_key, max(created_at) as latest_created_at, sum(stock)::numeric as stock
    from filtered
    group by group_key
  ),
  selected_groups as (
    select group_key
    from grouped
    order by latest_created_at desc, group_key
    offset (p_page - 1) * p_page_size
    limit p_page_size
  )
  select jsonb_build_object(
    'groupCount', (select count(*) from grouped),
    'inventoryStock', coalesce((select sum(stock) from grouped), 0),
    'rowCount', (select count(*) from filtered),
    'page', p_page,
    'pageSize', p_page_size,
    'products', coalesce((
      select jsonb_agg(to_jsonb(f) - 'user_id' - 'group_key' order by f.created_at desc, f.id desc)
      from filtered f
      join selected_groups s on s.group_key = f.group_key
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.search_inventory_groups(text, text, text, integer, integer) from public, anon;
grant execute on function public.search_inventory_groups(text, text, text, integer, integer) to authenticated;
