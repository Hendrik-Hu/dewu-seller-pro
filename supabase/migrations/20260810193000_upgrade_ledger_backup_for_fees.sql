begin;

alter table public.ledger_restore_items drop constraint if exists ledger_restore_items_entity_type_check;
alter table public.ledger_restore_items add constraint ledger_restore_items_entity_type_check
  check (entity_type in ('warehouse','product','activity','repair','fee_scheme'));
alter table public.ledger_restore_quarantine drop constraint if exists ledger_restore_quarantine_entity_type_check;
alter table public.ledger_restore_quarantine add constraint ledger_restore_quarantine_entity_type_check
  check (entity_type in ('warehouse','product','activity','repair','fee_scheme'));

create or replace function public.guard_outbound_fee_snapshot_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.allow_fee_snapshot_restore', true) = 'on' then return new; end if;
  if old.fee_snapshot is distinct from new.fee_snapshot
    or old.estimated_platform_fee is distinct from new.estimated_platform_fee
    or old.estimated_net_proceeds is distinct from new.estimated_net_proceeds
    or old.estimated_net_profit is distinct from new.estimated_net_profit then
    raise exception 'Outbound fee estimate snapshot is immutable';
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regprocedure('public.restore_ledger_backup_core_v1(uuid,text,jsonb,boolean)') is null
    and to_regprocedure('public.restore_ledger_backup(uuid,text,jsonb,boolean)') is not null then
    alter function public.restore_ledger_backup(uuid,text,jsonb,boolean) rename to restore_ledger_backup_core_v1;
  end if;
end;
$$;
revoke all on function public.restore_ledger_backup_core_v1(uuid,text,jsonb,boolean) from public, anon, authenticated;

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
  v_core_package jsonb;
  v_core_fingerprint text;
  v_core_result jsonb;
  v_existing_fingerprint text;
  v_existing_result jsonb;
  v_result jsonb;
  v_row jsonb;
  v_source_id text;
  v_target_id text;
  v_scheme_id uuid;
  v_created_at timestamptz;
  v_effective_from timestamptz;
  v_percent_rate numeric;
  v_percent_min numeric;
  v_percent_max numeric;
  v_fixed_fee numeric;
  v_shipping_fee numeric;
  v_other_fee numeric;
  v_added integer := 0;
  v_skipped integer := 0;
  v_details jsonb := '[]'::jsonb;
  v_details_truncated boolean := false;
  v_has_default boolean;
  v_restore_default boolean;
  v_seen_fee_sources text[] := array[]::text[];
  v_all_details jsonb;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if v_schema = 'dewu-seller-pro/ledger-backup@1' then
    return public.restore_ledger_backup_core_v1(p_user_id,p_operation_id,p_package#-'{data,feeSchemes}'#-'{counts,feeSchemes}',p_dry_run);
  end if;
  if v_schema <> 'dewu-seller-pro/ledger-backup@2' then raise exception 'Unsupported ledger backup schema'; end if;
  if trim(coalesce(p_operation_id,''))='' or length(p_operation_id)>160 then raise exception 'Invalid restore operation id'; end if;
  if pg_column_size(p_package)>26214400 then raise exception 'Ledger backup exceeds 25MB'; end if;
  if jsonb_typeof(p_package#>'{data,feeSchemes}')<>'array'
    or jsonb_typeof(p_package#>'{counts,feeSchemes}')<>'number' then raise exception 'Fee scheme backup data is incomplete'; end if;
  if jsonb_array_length(p_package#>'{data,feeSchemes}')<>(p_package#>>'{counts,feeSchemes}')::integer
    or jsonb_array_length(p_package#>'{data,feeSchemes}')>500 then raise exception 'Fee scheme backup count is invalid'; end if;
  if exists(select 1 from jsonb_object_keys(p_package->'counts') key where key not in ('products','activeProducts','recycledProducts','activities','warehouses','repairs','feeSchemes'))
    or exists(select 1 from jsonb_object_keys(p_package->'data') key where key not in ('products','activities','warehouses','repairs','feeSchemes'))
  then raise exception 'Ledger backup contains unsupported fee-era fields'; end if;

  for v_row in select value from jsonb_array_elements(p_package#>'{data,activities}') loop
    if jsonb_typeof(v_row)<>'object' or not (v_row ? 'feeSnapshot') or not (v_row ? 'estimatedPlatformFee')
      or not (v_row ? 'estimatedNetProceeds') or not (v_row ? 'estimatedNetProfit')
      or exists(select 1 from jsonb_object_keys(v_row) key where key not in (
        'sourceId','type','productName','sku','size','price','cost','count','warehouse','platform','source','createdAt',
        'feeSnapshot','estimatedPlatformFee','estimatedNetProceeds','estimatedNetProfit'))
      or jsonb_typeof(v_row->'feeSnapshot') not in ('object','null')
      or jsonb_typeof(v_row->'estimatedPlatformFee') not in ('number','null')
      or jsonb_typeof(v_row->'estimatedNetProceeds') not in ('number','null')
      or jsonb_typeof(v_row->'estimatedNetProfit') not in ('number','null')
      or pg_column_size(v_row->'feeSnapshot')>32768
    then raise exception 'Activity fee snapshot is invalid'; end if;
    if v_row->'estimatedPlatformFee'<>'null'::jsonb
      and ((v_row->>'estimatedPlatformFee')::numeric<0 or abs((v_row->>'estimatedPlatformFee')::numeric)>9999999999.99)
    then raise exception 'Activity fee amount is invalid'; end if;
    if v_row->'estimatedNetProceeds'<>'null'::jsonb and abs((v_row->>'estimatedNetProceeds')::numeric)>9999999999.99
      or v_row->'estimatedNetProfit'<>'null'::jsonb and abs((v_row->>'estimatedNetProfit')::numeric)>9999999999.99
    then raise exception 'Activity net amount is invalid'; end if;
    if v_row->'feeSnapshot'<>'null'::jsonb and coalesce(v_row->>'type','')<>'outbound' then
      raise exception 'Only outbound activities may contain fee snapshots';
    end if;
  end loop;

  v_core_package := p_package #- '{data,feeSchemes}' #- '{counts,feeSchemes}';
  v_core_package := jsonb_set(v_core_package,'{schemaVersion}','"dewu-seller-pro/ledger-backup@1"'::jsonb);
  v_core_package := jsonb_set(v_core_package,'{data,activities}',coalesce((
    select jsonb_agg(value-'feeSnapshot'-'estimatedPlatformFee'-'estimatedNetProceeds'-'estimatedNetProfit')
    from jsonb_array_elements(p_package#>'{data,activities}')
  ),'[]'::jsonb));
  v_core_fingerprint := encode(extensions.digest(convert_to(v_core_package::text,'UTF8'),'sha256'),'hex');

  if not p_dry_run then
    perform pg_advisory_xact_lock(hashtextextended('ledger-restore:'||p_user_id::text,0));
    insert into public.ledger_restore_operations(user_id,operation_id,client_hash,payload_fingerprint)
    values(p_user_id,p_operation_id,p_package#>>'{integrity,value}',v_fingerprint)
    on conflict(user_id,operation_id) do nothing;
    if not found then
      select payload_fingerprint,result into v_existing_fingerprint,v_existing_result
      from public.ledger_restore_operations where user_id=p_user_id and operation_id=p_operation_id;
      if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'Restore operation payload does not match original package'; end if;
      if v_existing_result is null then raise exception 'Restore operation is still processing'; end if;
      return v_existing_result;
    end if;
  end if;

  v_core_result := public.restore_ledger_backup_core_v1(
    p_user_id,'core-'||substr(encode(extensions.digest(convert_to(p_operation_id,'UTF8'),'sha256'),'hex'),1,48),v_core_package,p_dry_run
  );
  v_has_default := exists(select 1 from public.fee_schemes where user_id=p_user_id and is_default);

  for v_row in select value from jsonb_array_elements(p_package#>'{data,feeSchemes}') loop
    v_source_id := trim(coalesce(v_row->>'sourceId',''));
    begin
      if jsonb_typeof(v_row)<>'object'
        or exists(select 1 from jsonb_object_keys(v_row) key where key not in (
          'sourceId','name','saleMode','category','percentRate','percentMin','percentMax','percentageUnit','fixedFee','fixedFeeUnit',
          'shippingFee','shippingFeeUnit','otherFee','otherFeeUnit','effectiveFrom','isDefault','createdAt','updatedAt'))
        or jsonb_typeof(v_row->'sourceId')<>'string' or jsonb_typeof(v_row->'name')<>'string'
        or jsonb_typeof(v_row->'saleMode')<>'string' or jsonb_typeof(v_row->'category')<>'string'
        or jsonb_typeof(v_row->'percentRate')<>'number' or jsonb_typeof(v_row->'percentMin') not in ('number','null')
        or jsonb_typeof(v_row->'percentMax') not in ('number','null') or jsonb_typeof(v_row->'fixedFee')<>'number'
        or jsonb_typeof(v_row->'shippingFee')<>'number' or jsonb_typeof(v_row->'otherFee')<>'number'
        or jsonb_typeof(v_row->'isDefault')<>'boolean' or jsonb_typeof(v_row->'effectiveFrom')<>'string'
        or jsonb_typeof(v_row->'createdAt')<>'string' or jsonb_typeof(v_row->'updatedAt')<>'string'
      then raise exception 'shape'; end if;
      v_percent_rate:=(v_row->>'percentRate')::numeric;
      v_percent_min:=case when v_row->'percentMin'='null'::jsonb then null else (v_row->>'percentMin')::numeric end;
      v_percent_max:=case when v_row->'percentMax'='null'::jsonb then null else (v_row->>'percentMax')::numeric end;
      v_fixed_fee:=(v_row->>'fixedFee')::numeric; v_shipping_fee:=(v_row->>'shippingFee')::numeric; v_other_fee:=(v_row->>'otherFee')::numeric;
      v_effective_from:=(v_row->>'effectiveFrom')::timestamptz; v_created_at:=(v_row->>'createdAt')::timestamptz;
      if v_source_id='' or length(v_source_id)>256 or length(trim(v_row->>'name')) not between 1 and 60
        or length(v_row->>'saleMode')>60 or length(v_row->>'category')>60 or v_percent_rate not between 0 and 100
        or coalesce(v_percent_min,0)<0 or coalesce(v_percent_max,0)<0 or (v_percent_min is not null and v_percent_max is not null and v_percent_min>v_percent_max)
        or greatest(coalesce(v_percent_min,0),coalesce(v_percent_max,0),v_fixed_fee,v_shipping_fee,v_other_fee)>1000000
        or least(v_fixed_fee,v_shipping_fee,v_other_fee)<0
        or v_row->>'percentageUnit' not in ('transaction','item') or v_row->>'fixedFeeUnit' not in ('transaction','item')
        or v_row->>'shippingFeeUnit' not in ('transaction','item') or v_row->>'otherFeeUnit' not in ('transaction','item')
      then raise exception 'value'; end if;
    exception when others then raise exception 'Fee scheme backup row is invalid: %',left(v_source_id,80); end;

    if v_source_id=any(v_seen_fee_sources) then
      raise exception 'Fee scheme sourceId is duplicated: %',left(v_source_id,80);
    elsif exists(select 1 from public.ledger_restore_items where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='fee_scheme' and source_id=v_source_id)
      or exists(select 1 from public.fee_schemes where user_id=p_user_id and id::text=v_source_id) then
      v_skipped:=v_skipped+1;
      if not p_dry_run then
        select id into v_scheme_id from public.fee_schemes where user_id=p_user_id and id::text=v_source_id limit 1;
        if v_scheme_id is not null then insert into public.ledger_restore_items values(p_user_id,v_fingerprint,'fee_scheme',v_source_id,v_scheme_id::text,now()) on conflict do nothing; end if;
      end if;
    else
      v_added:=v_added+1;
      v_restore_default:=(v_row->>'isDefault')::boolean and not v_has_default;
      if v_restore_default then v_has_default:=true; end if;
      if not p_dry_run then
        v_scheme_id := (substr(md5(p_user_id::text||v_fingerprint||'fee_scheme'||v_source_id),1,8)||'-'||substr(md5(p_user_id::text||v_fingerprint||'fee_scheme'||v_source_id),9,4)||'-4'||substr(md5(p_user_id::text||v_fingerprint||'fee_scheme'||v_source_id),14,3)||'-a'||substr(md5(p_user_id::text||v_fingerprint||'fee_scheme'||v_source_id),18,3)||'-'||substr(md5(p_user_id::text||v_fingerprint||'fee_scheme'||v_source_id),21,12))::uuid;
        insert into public.fee_schemes(id,user_id,name,sale_mode,category,percent_rate,percent_min,percent_max,percentage_unit,
          fixed_fee,fixed_fee_unit,shipping_fee,shipping_fee_unit,other_fee,other_fee_unit,effective_from,is_default,created_at)
        values(v_scheme_id,p_user_id,trim(v_row->>'name'),trim(v_row->>'saleMode'),trim(v_row->>'category'),v_percent_rate,v_percent_min,v_percent_max,v_row->>'percentageUnit',
          v_fixed_fee,v_row->>'fixedFeeUnit',v_shipping_fee,v_row->>'shippingFeeUnit',v_other_fee,v_row->>'otherFeeUnit',v_effective_from,v_restore_default,v_created_at);
        insert into public.ledger_restore_items values(p_user_id,v_fingerprint,'fee_scheme',v_source_id,v_scheme_id::text,now());
      end if;
      if jsonb_array_length(v_details)<100 then v_details:=v_details||jsonb_build_array(jsonb_build_object('entity','feeScheme','sourceId',v_source_id,'outcome','added')); else v_details_truncated:=true; end if;
    end if;
    v_seen_fee_sources:=array_append(v_seen_fee_sources,v_source_id);
  end loop;

  if not p_dry_run then
    perform set_config('app.allow_fee_snapshot_restore','on',true);
    for v_row in select value from jsonb_array_elements(p_package#>'{data,activities}') loop
      v_source_id:=trim(v_row->>'sourceId');
      select target_id into v_target_id from public.ledger_restore_items
      where user_id=p_user_id and payload_fingerprint=v_core_fingerprint and entity_type='activity' and source_id=v_source_id;
      if v_target_id is not null then
        update public.activities set fee_snapshot=case when v_row->'feeSnapshot'='null'::jsonb then null else v_row->'feeSnapshot' end,
          estimated_platform_fee=case when v_row->'estimatedPlatformFee'='null'::jsonb then null else (v_row->>'estimatedPlatformFee')::numeric end,
          estimated_net_proceeds=case when v_row->'estimatedNetProceeds'='null'::jsonb then null else (v_row->>'estimatedNetProceeds')::numeric end,
          estimated_net_profit=case when v_row->'estimatedNetProfit'='null'::jsonb then null else (v_row->>'estimatedNetProfit')::numeric end
        where user_id=p_user_id and id=v_target_id;
      end if;
    end loop;
    perform set_config('app.allow_fee_snapshot_restore','off',true);
  end if;

  v_all_details:=coalesce(v_core_result->'details','[]'::jsonb)||v_details;
  if jsonb_array_length(v_all_details)>100 then
    v_details_truncated:=true;
    select coalesce(jsonb_agg(value),'[]'::jsonb) into v_all_details
    from (select value from jsonb_array_elements(v_all_details) limit 100) limited;
  end if;
  v_result:=jsonb_build_object(
    'dryRun',p_dry_run,'operationId',case when p_dry_run then null else p_operation_id end,'packageHash',p_package#>>'{integrity,value}',
    'payloadFingerprint',v_fingerprint,'added',(v_core_result->>'added')::integer+v_added,'merged',(v_core_result->>'merged')::integer,
    'conflicts',(v_core_result->>'conflicts')::integer,'skipped',(v_core_result->>'skipped')::integer+v_skipped,
    'details',v_all_details,
    'detailsTruncated',coalesce((v_core_result->>'detailsTruncated')::boolean,false) or v_details_truncated
  );
  if not p_dry_run then update public.ledger_restore_operations set result=v_result where user_id=p_user_id and operation_id=p_operation_id; end if;
  return v_result;
end;
$$;

revoke all on function public.restore_ledger_backup(uuid,text,jsonb,boolean) from public, anon;
grant execute on function public.restore_ledger_backup(uuid,text,jsonb,boolean) to authenticated;

commit;
