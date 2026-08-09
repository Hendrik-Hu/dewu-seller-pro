begin;

alter table public.ledger_restore_items drop constraint if exists ledger_restore_items_entity_type_check;
alter table public.ledger_restore_items add constraint ledger_restore_items_entity_type_check check (entity_type in ('warehouse','product','activity','repair','fee_scheme','settlement'));
alter table public.ledger_restore_quarantine drop constraint if exists ledger_restore_quarantine_entity_type_check;
alter table public.ledger_restore_quarantine add constraint ledger_restore_quarantine_entity_type_check check (entity_type in ('warehouse','product','activity','repair','fee_scheme','settlement'));

do $$ begin
  if to_regprocedure('public.restore_ledger_backup_core_v2(uuid,text,jsonb,boolean)') is null
    and to_regprocedure('public.restore_ledger_backup(uuid,text,jsonb,boolean)') is not null then
    alter function public.restore_ledger_backup(uuid,text,jsonb,boolean) rename to restore_ledger_backup_core_v2;
  end if;
end $$;
revoke all on function public.restore_ledger_backup_core_v2(uuid,text,jsonb,boolean) from public,anon,authenticated;

create or replace function public.restore_ledger_backup(p_user_id uuid,p_operation_id text,p_package jsonb,p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_schema text:=p_package->>'schemaVersion';
  v_fingerprint text:=encode(extensions.digest(convert_to(p_package::text,'UTF8'),'sha256'),'hex');
  v_package_v2 jsonb;
  v_package_v1 jsonb;
  v_mapping_fingerprint text;
  v_core_result jsonb;
  v_existing_fingerprint text;
  v_existing_result jsonb;
  v_result jsonb;
  v_row jsonb;
  v_source_id text;
  v_activity_source text;
  v_target_id text;
  v_target_audit_id uuid;
  v_revision integer;
  v_created_at timestamptz;
  v_settled_at timestamptz;
  v_added integer:=0;
  v_skipped integer:=0;
  v_conflicts integer:=0;
  v_details jsonb:='[]'::jsonb;
  v_details_truncated boolean:=false;
  v_preexisting_activity_sources text[]:=array[]::text[];
  v_seen_settlement_sources text[]:=array[]::text[];
  v_seen_settlement_revisions text[]:=array[]::text[];
  v_all_details jsonb;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if v_schema in ('dewu-seller-pro/ledger-backup@1','dewu-seller-pro/ledger-backup@2') then
    return public.restore_ledger_backup_core_v2(p_user_id,p_operation_id,p_package,p_dry_run);
  end if;
  if v_schema<>'dewu-seller-pro/ledger-backup@3' then raise exception 'Unsupported ledger backup schema'; end if;
  if trim(coalesce(p_operation_id,''))='' or length(p_operation_id)>160 then raise exception 'Invalid restore operation id'; end if;
  if pg_column_size(p_package)>26214400 then raise exception 'Ledger backup exceeds 25MB'; end if;
  if jsonb_typeof(p_package#>'{data,settlements}')<>'array' or jsonb_typeof(p_package#>'{counts,settlements}')<>'number' then raise exception 'Settlement backup data is incomplete'; end if;
  if jsonb_array_length(p_package#>'{data,settlements}')<>(p_package#>>'{counts,settlements}')::integer
    or jsonb_array_length(p_package#>'{data,settlements}')>50000 then raise exception 'Settlement backup count is invalid'; end if;
  if exists(select 1 from jsonb_object_keys(p_package->'counts') key where key not in ('products','activeProducts','recycledProducts','activities','warehouses','repairs','feeSchemes','settlements'))
    or exists(select 1 from jsonb_object_keys(p_package->'data') key where key not in ('products','activities','warehouses','repairs','feeSchemes','settlements'))
  then raise exception 'Ledger backup contains unsupported settlement-era fields'; end if;

  for v_row in select value from jsonb_array_elements(p_package#>'{data,activities}') loop
    if jsonb_typeof(v_row)<>'object'
      or not (v_row ?& array['actualPlatformFee','actualNetProceeds','actualNetProfit','settledAt','settlementOrderNo','settlementNote','settlementRevision'])
      or exists(select 1 from jsonb_object_keys(v_row) key where key not in (
        'sourceId','type','productName','sku','size','price','cost','count','warehouse','platform','source','createdAt',
        'feeSnapshot','estimatedPlatformFee','estimatedNetProceeds','estimatedNetProfit','actualPlatformFee','actualNetProceeds','actualNetProfit',
        'settledAt','settlementOrderNo','settlementNote','settlementRevision'))
      or jsonb_typeof(v_row->'settlementRevision')<>'number'
      or jsonb_typeof(v_row->'actualPlatformFee') not in ('number','null')
      or jsonb_typeof(v_row->'actualNetProceeds') not in ('number','null')
      or jsonb_typeof(v_row->'actualNetProfit') not in ('number','null')
      or jsonb_typeof(v_row->'settledAt') not in ('string','null')
      or jsonb_typeof(v_row->'settlementOrderNo')<>'string' or jsonb_typeof(v_row->'settlementNote')<>'string'
    then raise exception 'Activity settlement snapshot is invalid'; end if;
    begin
      v_revision:=(v_row->>'settlementRevision')::integer;
      if v_revision<0 or (v_revision=0 and (v_row->'actualPlatformFee'<>'null'::jsonb or v_row->'settledAt'<>'null'::jsonb))
        or (v_revision>0 and (v_row->'actualPlatformFee'='null'::jsonb or v_row->'actualNetProceeds'='null'::jsonb or v_row->'settledAt'='null'::jsonb))
        or (v_row->'actualPlatformFee'<>'null'::jsonb and ((v_row->>'actualPlatformFee')::numeric<0 or (v_row->>'actualPlatformFee')::numeric>1000000))
        or (v_row->'actualNetProceeds'<>'null'::jsonb and abs((v_row->>'actualNetProceeds')::numeric)>9999999999.99)
        or (v_row->'actualNetProfit'<>'null'::jsonb and abs((v_row->>'actualNetProfit')::numeric)>9999999999.99)
        or length(v_row->>'settlementOrderNo')>100 or length(v_row->>'settlementNote')>500 then raise exception 'value'; end if;
      if v_revision>0 then v_settled_at:=(v_row->>'settledAt')::timestamptz; end if;
    exception when others then raise exception 'Activity settlement snapshot is invalid'; end;
    v_source_id:=trim(v_row->>'sourceId');
    if exists(select 1 from public.activities where user_id=p_user_id and id=v_source_id) then v_preexisting_activity_sources:=array_append(v_preexisting_activity_sources,v_source_id); end if;
  end loop;

  for v_row in select value from jsonb_array_elements(p_package#>'{data,settlements}') loop
    if jsonb_typeof(v_row)<>'object' or exists(select 1 from jsonb_object_keys(v_row) key where key not in ('sourceId','activitySourceId','revision','previousSnapshot','settlementSnapshot','createdAt'))
      or jsonb_typeof(v_row->'sourceId')<>'string' or jsonb_typeof(v_row->'activitySourceId')<>'string' or jsonb_typeof(v_row->'revision')<>'number'
      or jsonb_typeof(v_row->'previousSnapshot') not in ('object','null') or jsonb_typeof(v_row->'settlementSnapshot')<>'object' or jsonb_typeof(v_row->'createdAt')<>'string'
      or pg_column_size(v_row->'settlementSnapshot')>32768 or pg_column_size(v_row->'previousSnapshot')>32768 then raise exception 'Settlement audit row is invalid'; end if;
    v_source_id:=trim(v_row->>'sourceId'); v_activity_source:=trim(v_row->>'activitySourceId');
    begin v_revision:=(v_row->>'revision')::integer; v_created_at:=(v_row->>'createdAt')::timestamptz;
    exception when others then raise exception 'Settlement audit row is invalid: %',left(v_source_id,80); end;
    if v_source_id='' or length(v_source_id)>256 or v_activity_source='' or length(v_activity_source)>200 or v_revision<=0 then raise exception 'Settlement audit row is invalid'; end if;
    if v_source_id=any(v_seen_settlement_sources) then raise exception 'Settlement audit sourceId is duplicated: %',left(v_source_id,80); end if;
    if (v_activity_source||':'||v_revision)=any(v_seen_settlement_revisions) then raise exception 'Settlement audit revision is duplicated'; end if;
    v_seen_settlement_sources:=array_append(v_seen_settlement_sources,v_source_id);
    v_seen_settlement_revisions:=array_append(v_seen_settlement_revisions,v_activity_source||':'||v_revision);
  end loop;

  if exists(select 1 from jsonb_array_elements(p_package#>'{data,activities}') a(value)
    where (a.value->>'settlementRevision')::integer>0 and not exists(
      select 1 from jsonb_array_elements(p_package#>'{data,settlements}') s(value)
      where s.value->>'activitySourceId'=a.value->>'sourceId' and (s.value->>'revision')::integer=(a.value->>'settlementRevision')::integer
    )) then raise exception 'Activity current settlement has no matching audit revision'; end if;

  v_package_v2:=p_package#-'{data,settlements}'#-'{counts,settlements}';
  v_package_v2:=jsonb_set(v_package_v2,'{schemaVersion}','"dewu-seller-pro/ledger-backup@2"'::jsonb);
  v_package_v2:=jsonb_set(v_package_v2,'{data,activities}',coalesce((select jsonb_agg(value-'actualPlatformFee'-'actualNetProceeds'-'actualNetProfit'-'settledAt'-'settlementOrderNo'-'settlementNote'-'settlementRevision') from jsonb_array_elements(p_package#>'{data,activities}')),'[]'::jsonb));
  v_package_v1:=v_package_v2#-'{data,feeSchemes}'#-'{counts,feeSchemes}';
  v_package_v1:=jsonb_set(v_package_v1,'{schemaVersion}','"dewu-seller-pro/ledger-backup@1"'::jsonb);
  v_package_v1:=jsonb_set(v_package_v1,'{data,activities}',coalesce((select jsonb_agg(value-'feeSnapshot'-'estimatedPlatformFee'-'estimatedNetProceeds'-'estimatedNetProfit') from jsonb_array_elements(v_package_v2#>'{data,activities}')),'[]'::jsonb));
  v_mapping_fingerprint:=encode(extensions.digest(convert_to(v_package_v1::text,'UTF8'),'sha256'),'hex');

  if not p_dry_run then
    perform pg_advisory_xact_lock(hashtextextended('ledger-restore:'||p_user_id::text,0));
    insert into public.ledger_restore_operations(user_id,operation_id,client_hash,payload_fingerprint) values(p_user_id,p_operation_id,p_package#>>'{integrity,value}',v_fingerprint) on conflict do nothing;
    if not found then
      select payload_fingerprint,result into v_existing_fingerprint,v_existing_result from public.ledger_restore_operations where user_id=p_user_id and operation_id=p_operation_id;
      if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'Restore operation payload does not match original package'; end if;
      if v_existing_result is null then raise exception 'Restore operation is still processing'; end if;
      return v_existing_result;
    end if;
  end if;

  v_core_result:=public.restore_ledger_backup_core_v2(p_user_id,'v2-'||substr(encode(extensions.digest(convert_to(p_operation_id,'UTF8'),'sha256'),'hex'),1,48),v_package_v2,p_dry_run);

  for v_row in select value from jsonb_array_elements(p_package#>'{data,settlements}') loop
    v_source_id:=trim(v_row->>'sourceId'); v_activity_source:=trim(v_row->>'activitySourceId');
    if exists(select 1 from public.outbound_settlement_audit where user_id=p_user_id and id::text=v_source_id)
      or exists(select 1 from public.ledger_restore_items where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='settlement' and source_id=v_source_id) then v_skipped:=v_skipped+1;
    elsif not (exists(select 1 from public.activities where user_id=p_user_id and id=v_activity_source)
      or exists(select 1 from jsonb_array_elements(p_package#>'{data,activities}') a(value) where a.value->>'sourceId'=v_activity_source)) then
      v_conflicts:=v_conflicts+1;
      if jsonb_array_length(v_details)<100 then v_details:=v_details||jsonb_build_array(jsonb_build_object('entity','settlement','sourceId',v_source_id,'outcome','conflict','reason','关联出库流水不存在')); else v_details_truncated:=true; end if;
    else v_added:=v_added+1; end if;
  end loop;

  if not p_dry_run then
    perform set_config('app.allow_fee_snapshot_restore','on',true);
    for v_row in select value from jsonb_array_elements(p_package#>'{data,activities}') loop
      v_source_id:=trim(v_row->>'sourceId');
      if not (v_source_id=any(v_preexisting_activity_sources)) then
        select target_id into v_target_id from public.ledger_restore_items where user_id=p_user_id and payload_fingerprint=v_mapping_fingerprint and entity_type='activity' and source_id=v_source_id;
        if v_target_id is not null then
          update public.activities set actual_platform_fee=case when v_row->'actualPlatformFee'='null'::jsonb then null else (v_row->>'actualPlatformFee')::numeric end,
            actual_net_proceeds=case when v_row->'actualNetProceeds'='null'::jsonb then null else (v_row->>'actualNetProceeds')::numeric end,
            actual_net_profit=case when v_row->'actualNetProfit'='null'::jsonb then null else (v_row->>'actualNetProfit')::numeric end,
            settled_at=case when v_row->'settledAt'='null'::jsonb then null else (v_row->>'settledAt')::timestamptz end,
            settlement_order_no=nullif(v_row->>'settlementOrderNo',''),settlement_note=nullif(v_row->>'settlementNote',''),settlement_revision=(v_row->>'settlementRevision')::integer
          where user_id=p_user_id and id=v_target_id;
        end if;
      end if;
    end loop;
    perform set_config('app.allow_fee_snapshot_restore','off',true);

    for v_row in select value from jsonb_array_elements(p_package#>'{data,settlements}') loop
      v_source_id:=trim(v_row->>'sourceId'); v_activity_source:=trim(v_row->>'activitySourceId'); v_revision:=(v_row->>'revision')::integer;
      if exists(select 1 from public.outbound_settlement_audit where user_id=p_user_id and id::text=v_source_id)
        or exists(select 1 from public.ledger_restore_items where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='settlement' and source_id=v_source_id) then continue; end if;
      select target_id into v_target_id from public.ledger_restore_items where user_id=p_user_id and payload_fingerprint=v_mapping_fingerprint and entity_type='activity' and source_id=v_activity_source;
      if v_target_id is null and exists(select 1 from public.activities where user_id=p_user_id and id=v_activity_source) then v_target_id:=v_activity_source; end if;
      if v_target_id is null or exists(select 1 from public.outbound_settlement_audit where user_id=p_user_id and activity_id=v_target_id and revision=v_revision) then
        insert into public.ledger_restore_quarantine values(p_user_id,v_fingerprint,'settlement',v_source_id,v_row,'关联流水不存在或修订版本冲突',now()) on conflict do nothing;
        continue;
      end if;
      v_target_audit_id:=(substr(md5(p_user_id::text||v_fingerprint||'settlement'||v_source_id),1,8)||'-'||substr(md5(p_user_id::text||v_fingerprint||'settlement'||v_source_id),9,4)||'-4'||substr(md5(p_user_id::text||v_fingerprint||'settlement'||v_source_id),14,3)||'-a'||substr(md5(p_user_id::text||v_fingerprint||'settlement'||v_source_id),18,3)||'-'||substr(md5(p_user_id::text||v_fingerprint||'settlement'||v_source_id),21,12))::uuid;
      insert into public.outbound_settlement_audit(id,user_id,activity_id,operation_id,payload_fingerprint,revision,previous_snapshot,settlement_snapshot,result,created_at)
      values(v_target_audit_id,p_user_id,v_target_id,'restore-'||substr(md5(v_fingerprint||v_source_id),1,40),encode(extensions.digest(convert_to(v_row::text,'UTF8'),'sha256'),'hex'),v_revision,
        case when v_row->'previousSnapshot'='null'::jsonb then null else v_row->'previousSnapshot' end,v_row->'settlementSnapshot',jsonb_build_object('restored',true,'activity_id',v_target_id,'settlement_revision',v_revision),
        (v_row->>'createdAt')::timestamptz);
      insert into public.ledger_restore_items values(p_user_id,v_fingerprint,'settlement',v_source_id,v_target_audit_id::text,now());
    end loop;
  end if;

  v_all_details:=coalesce(v_core_result->'details','[]'::jsonb)||v_details;
  if jsonb_array_length(v_all_details)>100 then v_details_truncated:=true; select coalesce(jsonb_agg(value),'[]'::jsonb) into v_all_details from (select value from jsonb_array_elements(v_all_details) limit 100) limited; end if;
  v_result:=jsonb_build_object('dryRun',p_dry_run,'operationId',case when p_dry_run then null else p_operation_id end,'packageHash',p_package#>>'{integrity,value}',
    'payloadFingerprint',v_fingerprint,'added',(v_core_result->>'added')::integer+v_added,'merged',(v_core_result->>'merged')::integer,
    'conflicts',(v_core_result->>'conflicts')::integer+v_conflicts,'skipped',(v_core_result->>'skipped')::integer+v_skipped,'details',v_all_details,
    'detailsTruncated',coalesce((v_core_result->>'detailsTruncated')::boolean,false) or v_details_truncated);
  if not p_dry_run then update public.ledger_restore_operations set result=v_result where user_id=p_user_id and operation_id=p_operation_id; end if;
  return v_result;
end;
$$;

revoke all on function public.restore_ledger_backup(uuid,text,jsonb,boolean) from public,anon;
grant execute on function public.restore_ledger_backup(uuid,text,jsonb,boolean) to authenticated;

commit;
