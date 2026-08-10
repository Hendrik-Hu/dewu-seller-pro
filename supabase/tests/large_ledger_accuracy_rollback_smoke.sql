begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_instance uuid := '00000000-0000-0000-0000-000000000000';
  v_warehouse_id uuid := gen_random_uuid();
  v_other_user uuid := gen_random_uuid();
  v_other_warehouse_id uuid := gen_random_uuid();
  v_now timestamptz := '2026-08-10 12:00:00+08';
  v_analytics jsonb;
  v_summary jsonb;
  v_search jsonb;
  v_failed boolean;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
  values(v_user,v_instance,'authenticated','authenticated','large-ledger-'||v_user||'@example.invalid','',now(),now(),now());
  insert into public.warehouses(id,user_id,name,is_default) values(v_warehouse_id,v_user,'Large ledger',true);

  insert into public.products(id,name,brand,size,sku,price,stock,image_url,status,location,created_at,warehouse,user_id,source)
  select
    'large-product-' || value,
    'Large product ' || value,
    case when value % 2 = 0 then 'Brand A' else '' end,
    (35 + value % 12)::text,
    'SKU-' || lpad(value::text, 5, '0'),
    10,
    1,
    '',
    'instock',
    '',
    v_now - (value || ' seconds')::interval,
    'Large ledger',
    v_user,
    'smoke'
  from generate_series(1,1005) value;

  insert into public.activities(id,type,product_name,time,sku,price,image_url,created_at,warehouse,cost,count,user_id,size)
  select
    'large-activity-' || value,
    'outbound',
    'Large sold ' || value,
    '',
    'SOLD-' || lpad(value::text, 5, '0'),
    20,
    '',
    v_now,
    'Large ledger',
    10,
    1,
    v_user,
    '42'
  from generate_series(1,1007) value;

  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_user,'role','authenticated')::text, true);
  v_analytics := public.get_inventory_analytics(v_now);
  if (v_analytics#>>'{dashboard,totalStock}')::numeric <> 1005
    or (v_analytics#>>'{dashboard,totalSkuCount}')::integer <> 1005
    or (v_analytics#>>'{dashboard,totalVariantCount}')::integer <> 1005
    or (v_analytics#>>'{monthly,outboundCount}')::numeric <> 1007
    or (v_analytics#>>'{monthly,salesAmount}')::numeric <> 20140
    or (v_analytics#>>'{monthly,grossProfitAmount}')::numeric <> 10070 then
    raise exception 'Authoritative analytics truncated the large ledger: %', v_analytics;
  end if;

  v_summary := public.get_inventory_warehouse_summary('Large ledger');
  if (v_summary->>'totalCount')::numeric <> 1005 or (v_summary->>'warehouseCount')::numeric <> 1005 then
    raise exception 'Warehouse summary truncated the large ledger: %', v_summary;
  end if;

  v_search := public.search_inventory_groups('Large ledger',null,'SKU-',51,20);
  if (v_search->>'groupCount')::integer <> 1005
    or (v_search->>'inventoryStock')::numeric <> 1005
    or jsonb_array_length(v_search->'products') <> 5 then
    raise exception 'Grouped search truncated or mispaged the large ledger: %', v_search - 'products';
  end if;

  v_failed := false;
  begin perform public.search_inventory_groups('Unknown warehouse',null,'SKU',1,20);
  exception when others then v_failed := sqlerrm like '%Warehouse does not exist%'; end;
  if not v_failed then raise exception 'Unknown warehouse search was accepted'; end if;

  v_failed := false;
  begin perform public.search_inventory_groups('Large ledger',null,'SKU',100001,20);
  exception when others then v_failed := sqlerrm like '%Search page is invalid%'; end;
  if not v_failed then raise exception 'Oversized search page was accepted'; end if;

  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
  values(v_other_user,v_instance,'authenticated','authenticated','analytics-boundary-'||v_other_user||'@example.invalid','',now(),now(),now());
  insert into public.warehouses(id,user_id,name,is_default) values(v_other_warehouse_id,v_other_user,'Boundary warehouse',true);
  perform set_config('app.allow_fee_snapshot_restore','on',true);
  insert into public.activities(
    id,type,product_name,time,sku,price,image_url,created_at,warehouse,cost,count,user_id,size,
    estimated_net_profit,actual_platform_fee,actual_net_proceeds,actual_net_profit,settled_at,settlement_revision
  ) values
    ('boundary-prev-month','outbound','Same display name','','BOUNDARY-A',100,'','2026-07-31 23:59:00+08','Boundary warehouse',60,1,v_other_user,'42',null,null,null,null,null,0),
    ('boundary-current-costed','outbound','Same display name','','BOUNDARY-A',100,'','2026-08-01 00:01:00+08','Boundary warehouse',60,2,v_other_user,'42',70,20,180,60,'2026-08-01 00:10:00+08',1),
    ('boundary-current-missing','outbound','Same display name','','BOUNDARY-B',50,'','2026-08-01 00:02:00+08','Boundary warehouse',null,3,v_other_user,'43',null,null,null,null,null,0),
    ('boundary-rolling-in','outbound','Rolling inside','','ROLL-IN',10,'','2026-07-03 00:00:00+08','Boundary warehouse',5,4,v_other_user,'44',null,null,null,null,null,0),
    ('boundary-rolling-out','outbound','Rolling outside','','ROLL-OUT',10,'','2026-07-02 23:59:00+08','Boundary warehouse',5,5,v_other_user,'45',null,null,null,null,null,0);
  perform set_config('app.allow_fee_snapshot_restore','off',true);

  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_other_user,'role','authenticated')::text, true);
  v_analytics := public.get_inventory_analytics('2026-08-01 00:30:00+08');
  if (v_analytics#>>'{dashboard,todaySalesAmount}')::numeric <> 350
    or (v_analytics#>>'{dashboard,todaySalesCount}')::numeric <> 5
    or (v_analytics#>>'{monthly,salesAmount}')::numeric <> 350
    or (v_analytics#>>'{monthly,costedSalesAmount}')::numeric <> 200
    or (v_analytics#>>'{monthly,costAmount}')::numeric <> 120
    or (v_analytics#>>'{monthly,grossProfitAmount}')::numeric <> 80
    or (v_analytics#>>'{monthly,outboundCount}')::numeric <> 5
    or (v_analytics#>>'{monthly,missingCostCount}')::numeric <> 3
    or round((v_analytics#>>'{monthly,costCoverageRate}')::numeric,2) <> 40
    or (v_analytics#>>'{monthly,estimatedNetProfitAmount}')::numeric <> 70
    or (v_analytics#>>'{monthly,estimatedProfitCount}')::numeric <> 2
    or (v_analytics#>>'{monthly,actualNetProfitAmount}')::numeric <> 60
    or (v_analytics#>>'{monthly,actualProfitCount}')::numeric <> 2
    or round((v_analytics#>>'{monthly,settlementCoverageRate}')::numeric,2) <> 40 then
    raise exception 'Shanghai boundary or profit coverage semantics drifted: %', v_analytics;
  end if;
  if (select sum((item->>'value')::numeric) from jsonb_array_elements(v_analytics#>'{charts,salesTrend}') item) <> 490 then
    raise exception 'Rolling 30 natural day boundary drifted: %', v_analytics#>'{charts,salesTrend}';
  end if;
  if not exists(select 1 from jsonb_array_elements(v_analytics#>'{charts,topProducts}') item where item->>'sku'='BOUNDARY-A')
    or not exists(select 1 from jsonb_array_elements(v_analytics#>'{charts,topProducts}') item where item->>'sku'='BOUNDARY-B') then
    raise exception 'Same-name different-SKU sales were merged: %', v_analytics#>'{charts,topProducts}';
  end if;

  -- A new authenticated identity sees only its own empty account, never the large-ledger account.
  perform set_config('request.jwt.claims', jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text, true);
  v_analytics := public.get_inventory_analytics(v_now);
  if (v_analytics#>>'{dashboard,totalStock}')::numeric <> 0 or (v_analytics#>>'{monthly,outboundCount}')::numeric <> 0 then
    raise exception 'Cross-user analytics leaked another seller data';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('role','anon')::text, true);
  v_failed := false;
  begin perform public.get_inventory_analytics(v_now);
  exception when others then v_failed := sqlerrm like '%Authentication required%'; end;
  if not v_failed then raise exception 'Anonymous analytics request was accepted'; end if;
end;
$$;

rollback;
