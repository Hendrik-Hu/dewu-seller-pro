begin;

alter table public.ledger_restore_items drop constraint if exists ledger_restore_items_entity_type_check;
alter table public.ledger_restore_items add constraint ledger_restore_items_entity_type_check
  check (entity_type in ('warehouse','product','activity','repair','fee_scheme','settlement','inventory_adjustment','sales_order','sales_order_event'));
alter table public.ledger_restore_quarantine drop constraint if exists ledger_restore_quarantine_entity_type_check;
alter table public.ledger_restore_quarantine add constraint ledger_restore_quarantine_entity_type_check
  check (entity_type in ('warehouse','product','activity','repair','fee_scheme','settlement','inventory_adjustment','sales_order','sales_order_event'));

alter function public.restore_ledger_backup(uuid,text,jsonb,boolean)
  rename to restore_ledger_backup_pre_sales_order_v23;
revoke all on function public.restore_ledger_backup_pre_sales_order_v23(uuid,text,jsonb,boolean)
  from public,anon,authenticated;

create or replace function public.restore_ledger_backup(
  p_user_id uuid,
  p_operation_id text,
  p_package jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_schema text := p_package->>'schemaVersion';
  v_fingerprint text := encode(extensions.digest(convert_to(p_package::text,'UTF8'),'sha256'),'hex');
  v_filtered jsonb;
  v_result jsonb;
  v_existing_fingerprint text;
  v_existing_result jsonb;
  v_orders jsonb;
  v_events jsonb;
  v_row jsonb;
  v_source_id text;
  v_order_source_id text;
  v_product_source_id text;
  v_activity_source_id text;
  v_target_product_id text;
  v_target_activity_id text;
  v_target_order_id uuid;
  v_target_event_id uuid;
  v_status text;
  v_action text;
  v_from_status text;
  v_to_status text;
  v_quantity integer;
  v_version integer;
  v_sale_price numeric;
  v_cost numeric;
  v_created_at timestamptz;
  v_updated_at timestamptz;
  v_reason text;
  v_added integer := 0;
  v_conflicts integer := 0;
  v_skipped integer := 0;
  v_details jsonb := '[]'::jsonb;
  v_details_truncated boolean := false;
  v_seen_orders text[] := array[]::text[];
  v_seen_events text[] := array[]::text[];
  v_index integer := 0;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if char_length(btrim(coalesce(p_operation_id,''))) not between 8 and 120 then raise exception '恢复操作标识无效'; end if;
  if jsonb_typeof(p_package) is distinct from 'object' then raise exception '账本包必须是对象'; end if;
  if octet_length(convert_to(p_package::text,'UTF8')) > 26214400 then raise exception '账本包超过 25 MB 服务端上限'; end if;

  if v_schema <> 'dewu-seller-pro/ledger-backup@5' then
    if not p_dry_run then perform pg_advisory_xact_lock(hashtextextended('ledger-restore:'||p_user_id::text,0)); end if;
    return public.restore_ledger_backup_pre_sales_order_v23(p_user_id,p_operation_id,p_package,p_dry_run);
  end if;

  if exists (select 1 from jsonb_object_keys(p_package) key where key not in ('schemaVersion','exportedAt','scope','counts','media','data','integrity'))
    or jsonb_typeof(p_package->'data') is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_package->'data') key where key not in ('products','activities','warehouses','repairs','feeSchemes','settlements','inventoryAdjustments','salesOrders','salesOrderEvents'))
    or jsonb_typeof(p_package#>'{data,salesOrders}') is distinct from 'array'
    or jsonb_typeof(p_package#>'{data,salesOrderEvents}') is distinct from 'array' then
    raise exception '销售订单账本包结构无效';
  end if;
  v_orders := p_package#>'{data,salesOrders}';
  v_events := p_package#>'{data,salesOrderEvents}';
  if jsonb_array_length(v_orders)>50000 or jsonb_array_length(v_events)>100000 then raise exception '销售订单账本超过恢复数量上限'; end if;
  if (p_package#>>'{counts,salesOrders}') is null or (p_package#>>'{counts,salesOrders}')::integer<>jsonb_array_length(v_orders)
    or (p_package#>>'{counts,salesOrderEvents}') is null or (p_package#>>'{counts,salesOrderEvents}')::integer<>jsonb_array_length(v_events) then
    raise exception '销售订单账本计数校验失败';
  end if;

  -- Preview runs the exact write path inside a subtransaction, then rolls it back.
  if p_dry_run then
    begin
      v_result := public.restore_ledger_backup(
        p_user_id,
        'preview-v23-'||substr(encode(extensions.digest(convert_to(p_operation_id||':'||clock_timestamp()::text,'UTF8'),'sha256'),'hex'),1,48),
        p_package,
        false
      );
      raise exception 'SALES_ORDER_PREVIEW_ROLLBACK';
    exception when raise_exception then
      if sqlerrm <> 'SALES_ORDER_PREVIEW_ROLLBACK' then raise; end if;
    end;
    return jsonb_set(jsonb_set(v_result,'{dryRun}','true'::jsonb),'{operationId}','null'::jsonb);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ledger-restore:'||p_user_id::text,0));
  select payload_fingerprint,result into v_existing_fingerprint,v_existing_result
  from public.ledger_restore_operations where user_id=p_user_id and operation_id=p_operation_id;
  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'Restore operation payload does not match original package'; end if;
    if v_existing_result is null then raise exception 'Restore operation is still processing'; end if;
    return v_existing_result;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_orders) item
    join public.ledger_restore_items mapped on mapped.user_id=p_user_id and mapped.entity_type='sales_order'
      and mapped.source_id=btrim(coalesce(item->>'sourceId','')) and mapped.payload_fingerprint<>v_fingerprint
  ) then raise exception '检测到另一代销售订单账本，更新版完整备份只能恢复到空账本'; end if;
  insert into public.ledger_restore_operations(user_id,operation_id,client_hash,payload_fingerprint)
  values(p_user_id,p_operation_id,coalesce(p_package#>>'{integrity,value}',''),v_fingerprint);

  v_filtered := jsonb_set(p_package,'{schemaVersion}',to_jsonb('dewu-seller-pro/ledger-backup@4'::text));
  v_filtered := v_filtered #- '{data,salesOrders}' #- '{data,salesOrderEvents}' #- '{counts,salesOrders}' #- '{counts,salesOrderEvents}';
  v_result := public.restore_ledger_backup_pre_sales_order_v23(
    p_user_id,
    'v23-core-'||substr(encode(extensions.digest(convert_to(p_operation_id,'UTF8'),'sha256'),'hex'),1,48),
    v_filtered,
    false
  );

  for v_row in select value from jsonb_array_elements(v_orders) loop
    v_index:=v_index+1; v_reason:=null; v_target_product_id:=null; v_target_activity_id:=null;
    v_source_id:=case when jsonb_typeof(v_row)='object' then btrim(coalesce(v_row->>'sourceId','')) else '#row-'||v_index end;
    begin
      if jsonb_typeof(v_row) is distinct from 'object' then raise exception '订单记录不是对象'; end if;
      if exists (select 1 from jsonb_object_keys(v_row) key where key not in (
        'sourceId','productSourceId','status','productName','brand','sku','size','warehouse','quantity','unitSalePrice','frozenUnitCost','platform','externalOrderNo','note','feeSnapshot','estimatedPlatformFee','estimatedNetProceeds','estimatedNetProfit','outboundActivitySourceId','inventoryRestored','version','createdAt','updatedAt','shippedAt','authenticationStartedAt','authenticatedAt','settledAt','canceledAt','returnStartedAt','returnedAt','refundedAt'
      )) then raise exception '订单包含未知字段'; end if;
      if jsonb_typeof(v_row->'sourceId')<>'string' or jsonb_typeof(v_row->'productSourceId')<>'string'
        or jsonb_typeof(v_row->'status')<>'string' or jsonb_typeof(v_row->'productName')<>'string'
        or jsonb_typeof(v_row->'brand')<>'string' or jsonb_typeof(v_row->'sku')<>'string'
        or jsonb_typeof(v_row->'size')<>'string' or jsonb_typeof(v_row->'warehouse')<>'string'
        or jsonb_typeof(v_row->'quantity')<>'number' or jsonb_typeof(v_row->'unitSalePrice')<>'number'
        or jsonb_typeof(v_row->'frozenUnitCost')<>'number' or jsonb_typeof(v_row->'platform')<>'string'
        or jsonb_typeof(v_row->'feeSnapshot')<>'object' or jsonb_typeof(v_row->'inventoryRestored')<>'boolean'
        or jsonb_typeof(v_row->'version')<>'number' or jsonb_typeof(v_row->'createdAt')<>'string'
        or jsonb_typeof(v_row->'updatedAt')<>'string'
        or (v_row->'estimatedPlatformFee' is not null and jsonb_typeof(v_row->'estimatedPlatformFee') not in ('number','null'))
        or (v_row->'estimatedNetProceeds' is not null and jsonb_typeof(v_row->'estimatedNetProceeds') not in ('number','null'))
        or (v_row->'estimatedNetProfit' is not null and jsonb_typeof(v_row->'estimatedNetProfit') not in ('number','null'))
        or (v_row->'outboundActivitySourceId' is not null and jsonb_typeof(v_row->'outboundActivitySourceId')<>'string')
        or (v_row->'externalOrderNo' is not null and jsonb_typeof(v_row->'externalOrderNo') not in ('string','null'))
        or (v_row->'note' is not null and jsonb_typeof(v_row->'note') not in ('string','null'))
        or exists (
          select 1 from (values ('shippedAt'),('authenticationStartedAt'),('authenticatedAt'),('settledAt'),('canceledAt'),('returnStartedAt'),('returnedAt'),('refundedAt')) field(key)
          where v_row->field.key is not null and jsonb_typeof(v_row->field.key) not in ('string','null')
        ) then raise exception '订单字段类型无效'; end if;
      if v_source_id=any(v_seen_orders) then raise exception '账本包内订单 sourceId 重复'; end if;
      v_seen_orders:=array_append(v_seen_orders,v_source_id);
      v_product_source_id:=btrim(v_row->>'productSourceId'); v_activity_source_id:=btrim(coalesce(v_row->>'outboundActivitySourceId',''));
      v_status:=v_row->>'status'; v_quantity:=(v_row->>'quantity')::integer; v_version:=(v_row->>'version')::integer;
      v_sale_price:=round((v_row->>'unitSalePrice')::numeric,2); v_cost:=round((v_row->>'frozenUnitCost')::numeric,2);
      v_created_at:=(v_row->>'createdAt')::timestamptz; v_updated_at:=(v_row->>'updatedAt')::timestamptz;
      if v_source_id::uuid is null or char_length(v_product_source_id) not between 1 and 200
        or v_status not in ('pending_shipment','shipped','authenticating','authenticated','settled','canceled','auth_failed','returning','returned','refunded')
        or v_quantity not between 1 and 1000 or v_version<=0 or v_sale_price<0 or v_sale_price>1000000 or v_cost<0 or v_cost>1000000
        or char_length(v_row->>'productName') not between 1 and 160 or char_length(v_row->>'brand') not between 1 and 80
        or char_length(v_row->>'sku') not between 1 and 120 or char_length(v_row->>'size') not between 1 and 40
        or char_length(v_row->>'warehouse') not between 1 and 60 or char_length(v_row->>'platform') not between 1 and 60
        or char_length(coalesce(v_row->>'externalOrderNo',''))>120 or char_length(coalesce(v_row->>'note',''))>500
        or v_created_at<timestamptz '2000-01-01' or v_updated_at>now()+interval '1 day' then raise exception '订单字段值无效'; end if;
      perform nullif(v_row->>'shippedAt','')::timestamptz;
      perform nullif(v_row->>'authenticationStartedAt','')::timestamptz;
      perform nullif(v_row->>'authenticatedAt','')::timestamptz;
      perform nullif(v_row->>'settledAt','')::timestamptz;
      perform nullif(v_row->>'canceledAt','')::timestamptz;
      perform nullif(v_row->>'returnStartedAt','')::timestamptz;
      perform nullif(v_row->>'returnedAt','')::timestamptz;
      perform nullif(v_row->>'refundedAt','')::timestamptz;
      if v_status in ('shipped','authenticating','authenticated','settled','auth_failed','returning','returned','refunded') and v_activity_source_id='' then
        raise exception '已发货订单缺少关联出库流水';
      end if;
      if (v_row->>'inventoryRestored')::boolean and v_status not in ('canceled','returned','refunded') then
        raise exception '订单库存恢复标记与状态冲突';
      end if;
    exception when others then v_reason:=sqlerrm; end;

    if v_reason is null and (exists(select 1 from public.sales_orders where user_id=p_user_id and id::text=v_source_id)
      or exists(select 1 from public.ledger_restore_items where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='sales_order' and source_id=v_source_id)) then
      v_skipped:=v_skipped+1;
    elsif v_reason is null then
      select id into v_target_product_id from public.products where user_id=p_user_id and id=v_product_source_id limit 1;
      if v_target_product_id is null then select target_id into v_target_product_id from public.ledger_restore_items where user_id=p_user_id and entity_type='product' and source_id=v_product_source_id order by restored_at desc limit 1; end if;
      if v_target_product_id is null then v_reason:='订单关联商品未恢复'; end if;
      if v_reason is null and v_activity_source_id<>'' then
        select id into v_target_activity_id from public.activities where user_id=p_user_id and id=v_activity_source_id limit 1;
        if v_target_activity_id is null then select target_id into v_target_activity_id from public.ledger_restore_items where user_id=p_user_id and entity_type='activity' and source_id=v_activity_source_id order by restored_at desc limit 1; end if;
        if v_target_activity_id is null then v_reason:='订单关联出库流水未恢复'; end if;
      end if;
    end if;

    if v_reason is not null then
      v_conflicts:=v_conflicts+1;
      insert into public.ledger_restore_quarantine(user_id,payload_fingerprint,entity_type,source_id,payload,reason)
      values(p_user_id,v_fingerprint,'sales_order',v_source_id,v_row,v_reason) on conflict do nothing;
      if jsonb_array_length(v_details)<100 then v_details:=v_details||jsonb_build_array(jsonb_build_object('entity','sales_order','sourceId',v_source_id,'outcome','conflict','reason',v_reason)); else v_details_truncated:=true; end if;
    elsif not exists(select 1 from public.sales_orders where user_id=p_user_id and id::text=v_source_id)
      and not exists(select 1 from public.ledger_restore_items where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='sales_order' and source_id=v_source_id) then
      v_added:=v_added+1;
      v_target_order_id:=md5(p_user_id::text||v_fingerprint||'sales_order'||v_source_id)::uuid;
      insert into public.sales_orders(
        id,user_id,product_id,status,product_name,brand,sku,size,warehouse,quantity,unit_sale_price,frozen_unit_cost,platform,external_order_no,note,fee_snapshot,estimated_platform_fee,estimated_net_proceeds,estimated_net_profit,outbound_activity_id,inventory_restored,version,created_at,updated_at,shipped_at,authentication_started_at,authenticated_at,settled_at,canceled_at,return_started_at,returned_at,refunded_at
      ) values (
        v_target_order_id,p_user_id,v_target_product_id,v_status,v_row->>'productName',v_row->>'brand',upper(btrim(v_row->>'sku')),v_row->>'size',v_row->>'warehouse',v_quantity,v_sale_price,v_cost,v_row->>'platform',nullif(btrim(coalesce(v_row->>'externalOrderNo','')),''),nullif(btrim(coalesce(v_row->>'note','')),''),v_row->'feeSnapshot',
        case when v_row->'estimatedPlatformFee'='null'::jsonb then null else (v_row->>'estimatedPlatformFee')::numeric end,
        case when v_row->'estimatedNetProceeds'='null'::jsonb then null else (v_row->>'estimatedNetProceeds')::numeric end,
        case when v_row->'estimatedNetProfit'='null'::jsonb then null else (v_row->>'estimatedNetProfit')::numeric end,
        v_target_activity_id,(v_row->>'inventoryRestored')::boolean,v_version,v_created_at,v_updated_at,
        nullif(v_row->>'shippedAt','')::timestamptz,nullif(v_row->>'authenticationStartedAt','')::timestamptz,nullif(v_row->>'authenticatedAt','')::timestamptz,nullif(v_row->>'settledAt','')::timestamptz,nullif(v_row->>'canceledAt','')::timestamptz,nullif(v_row->>'returnStartedAt','')::timestamptz,nullif(v_row->>'returnedAt','')::timestamptz,nullif(v_row->>'refundedAt','')::timestamptz
      );
      if v_target_activity_id is not null then
        update public.activities set sales_order_id=v_target_order_id
        where user_id=p_user_id and id=v_target_activity_id and sales_order_id is null;
      end if;
      insert into public.ledger_restore_items(user_id,payload_fingerprint,entity_type,source_id,target_id)
      values(p_user_id,v_fingerprint,'sales_order',v_source_id,v_target_order_id::text);
    end if;
  end loop;

  v_index:=0;
  for v_row in select value from jsonb_array_elements(v_events) loop
    v_index:=v_index+1; v_reason:=null; v_target_order_id:=null;
    v_source_id:=case when jsonb_typeof(v_row)='object' then btrim(coalesce(v_row->>'sourceId','')) else '#row-'||v_index end;
    begin
      if jsonb_typeof(v_row)<>'object' or jsonb_typeof(v_row->'sourceId')<>'string' or jsonb_typeof(v_row->'orderSourceId')<>'string'
        or jsonb_typeof(v_row->'operationId')<>'string' or jsonb_typeof(v_row->'payloadFingerprint')<>'string'
        or jsonb_typeof(v_row->'action')<>'string' or jsonb_typeof(v_row->'toStatus')<>'string'
        or jsonb_typeof(v_row->'details')<>'object' or jsonb_typeof(v_row->'result')<>'object' or jsonb_typeof(v_row->'createdAt')<>'string' then raise exception '订单事件字段类型无效'; end if;
      if v_source_id=any(v_seen_events) then raise exception '账本包内订单事件 sourceId 重复'; end if;
      v_seen_events:=array_append(v_seen_events,v_source_id); v_order_source_id:=btrim(v_row->>'orderSourceId');
      v_action:=v_row->>'action'; v_from_status:=nullif(v_row->>'fromStatus',''); v_to_status:=v_row->>'toStatus'; v_created_at:=(v_row->>'createdAt')::timestamptz;
      if v_source_id::uuid is null or char_length(v_order_source_id)<1 or char_length(v_row->>'operationId') not between 8 and 120
        or (v_row->>'payloadFingerprint') !~ '^[0-9a-f]{64}$'
        or v_action not in ('create','ship','start_authentication','pass_authentication','fail_authentication','settle','cancel','start_return','confirm_return','complete_refund')
        or v_to_status not in ('pending_shipment','shipped','authenticating','authenticated','settled','canceled','auth_failed','returning','returned','refunded')
        or v_created_at<timestamptz '2000-01-01' or v_created_at>now()+interval '1 day' then raise exception '订单事件字段值无效'; end if;
    exception when others then v_reason:=sqlerrm; end;
    if v_reason is null and (exists(select 1 from public.sales_order_events where user_id=p_user_id and id::text=v_source_id)
      or exists(select 1 from public.ledger_restore_items where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='sales_order_event' and source_id=v_source_id)) then v_skipped:=v_skipped+1;
    elsif v_reason is null then
      select id into v_target_order_id from public.sales_orders where user_id=p_user_id and id::text=v_order_source_id limit 1;
      if v_target_order_id is null then select target_id::uuid into v_target_order_id from public.ledger_restore_items where user_id=p_user_id and entity_type='sales_order' and source_id=v_order_source_id order by restored_at desc limit 1; end if;
      if v_target_order_id is null then v_reason:='订单事件关联订单未恢复'; end if;
    end if;
    if v_reason is not null then
      v_conflicts:=v_conflicts+1;
      insert into public.ledger_restore_quarantine(user_id,payload_fingerprint,entity_type,source_id,payload,reason)
      values(p_user_id,v_fingerprint,'sales_order_event',v_source_id,v_row,v_reason) on conflict do nothing;
      if jsonb_array_length(v_details)<100 then v_details:=v_details||jsonb_build_array(jsonb_build_object('entity','sales_order_event','sourceId',v_source_id,'outcome','conflict','reason',v_reason)); else v_details_truncated:=true; end if;
    elsif not exists(select 1 from public.sales_order_events where user_id=p_user_id and id::text=v_source_id)
      and not exists(select 1 from public.ledger_restore_items where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='sales_order_event' and source_id=v_source_id) then
      v_added:=v_added+1; v_target_event_id:=md5(p_user_id::text||v_fingerprint||'sales_order_event'||v_source_id)::uuid;
      insert into public.sales_order_events(id,user_id,order_id,operation_id,payload_fingerprint,action,from_status,to_status,details,result,created_at)
      values(v_target_event_id,p_user_id,v_target_order_id,'restore-order-event-'||substr(encode(extensions.digest(convert_to(v_fingerprint||v_source_id,'UTF8'),'sha256'),'hex'),1,48),v_row->>'payloadFingerprint',v_action,v_from_status,v_to_status,v_row->'details',v_row->'result',v_created_at);
      insert into public.ledger_restore_items(user_id,payload_fingerprint,entity_type,source_id,target_id)
      values(p_user_id,v_fingerprint,'sales_order_event',v_source_id,v_target_event_id::text);
    end if;
  end loop;

  v_result:=jsonb_set(v_result,'{packageHash}',to_jsonb(coalesce(p_package#>>'{integrity,value}','')));
  v_result:=jsonb_set(v_result,'{payloadFingerprint}',to_jsonb(v_fingerprint));
  v_result:=jsonb_set(v_result,'{operationId}',to_jsonb(p_operation_id));
  v_result:=jsonb_set(v_result,'{added}',to_jsonb(coalesce((v_result->>'added')::integer,0)+v_added));
  v_result:=jsonb_set(v_result,'{skipped}',to_jsonb(coalesce((v_result->>'skipped')::integer,0)+v_skipped));
  v_result:=jsonb_set(v_result,'{conflicts}',to_jsonb(coalesce((v_result->>'conflicts')::integer,0)+v_conflicts));
  v_result:=jsonb_set(v_result,'{details}',coalesce(v_result->'details','[]'::jsonb)||v_details);
  if jsonb_array_length(v_result->'details')>100 then
    v_result:=jsonb_set(v_result,'{details}',(select coalesce(jsonb_agg(value),'[]'::jsonb) from (select value from jsonb_array_elements(v_result->'details') limit 100) limited));
    v_details_truncated:=true;
  end if;
  v_result:=jsonb_set(v_result,'{detailsTruncated}',to_jsonb(coalesce((v_result->>'detailsTruncated')::boolean,false) or v_details_truncated));
  update public.ledger_restore_operations set result=v_result where user_id=p_user_id and operation_id=p_operation_id;
  return v_result;
end;
$$;

revoke all on function public.restore_ledger_backup(uuid,text,jsonb,boolean) from public,anon;
grant execute on function public.restore_ledger_backup(uuid,text,jsonb,boolean) to authenticated;

commit;
