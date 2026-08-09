begin;

create or replace function public.restore_ledger_backup(p_user_id uuid,p_operation_id text,p_package jsonb,p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_schema text:=p_package->>'schemaVersion';
  v_fingerprint text:=encode(extensions.digest(convert_to(p_package::text,'UTF8'),'sha256'),'hex');
  v_filtered jsonb:=p_package;
  v_filtered_fingerprint text;
  v_result jsonb;
  v_existing_fingerprint text;
  v_existing_result jsonb;
  v_removed_settlements integer:=0;
  v_products jsonb;
  v_activities jsonb;
  v_warehouses jsonb;
  v_repairs jsonb;
  v_fee_schemes jsonb;
  v_settlements jsonb;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if v_schema not in ('dewu-seller-pro/ledger-backup@1','dewu-seller-pro/ledger-backup@2','dewu-seller-pro/ledger-backup@3') then
    raise exception 'Unsupported ledger backup schema';
  end if;

  if not p_dry_run then
    select payload_fingerprint,result into v_existing_fingerprint,v_existing_result
    from public.ledger_restore_operations where user_id=p_user_id and operation_id=p_operation_id;
    if found then
      if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'Restore operation payload does not match original package'; end if;
      if v_existing_result is null then raise exception 'Restore operation is still processing'; end if;
      return v_existing_result;
    end if;
  end if;

  v_products:=case when jsonb_typeof(p_package#>'{data,products}')='array' then p_package#>'{data,products}' else '[]'::jsonb end;
  v_activities:=case when jsonb_typeof(p_package#>'{data,activities}')='array' then p_package#>'{data,activities}' else '[]'::jsonb end;
  v_warehouses:=case when jsonb_typeof(p_package#>'{data,warehouses}')='array' then p_package#>'{data,warehouses}' else '[]'::jsonb end;
  v_repairs:=case when jsonb_typeof(p_package#>'{data,repairs}')='array' then p_package#>'{data,repairs}' else '[]'::jsonb end;
  v_fee_schemes:=case when jsonb_typeof(p_package#>'{data,feeSchemes}')='array' then p_package#>'{data,feeSchemes}' else '[]'::jsonb end;
  v_settlements:=case when jsonb_typeof(p_package#>'{data,settlements}')='array' then p_package#>'{data,settlements}' else '[]'::jsonb end;

  if not exists(select 1 from public.ledger_restore_operations where user_id=p_user_id and payload_fingerprint=v_fingerprint and result is not null) and exists(
    select 1 from public.ledger_restore_items i where i.user_id=p_user_id and i.payload_fingerprint<>v_fingerprint and (
      (i.entity_type='activity' and exists(select 1 from jsonb_array_elements(v_activities) a(value) where a.value->>'sourceId'=i.source_id))
      or (i.entity_type='product' and exists(select 1 from jsonb_array_elements(v_products) p(value) where p.value->>'sourceId'=i.source_id))
      or (i.entity_type='warehouse' and exists(select 1 from jsonb_array_elements(v_warehouses) w(value) where w.value->>'sourceId'=i.source_id))
      or (i.entity_type='repair' and exists(select 1 from jsonb_array_elements(v_repairs) r(value) where r.value->>'sourceId'=i.source_id))
      or (i.entity_type='fee_scheme' and exists(select 1 from jsonb_array_elements(v_fee_schemes) f(value) where f.value->>'sourceId'=i.source_id))
      or (i.entity_type='settlement' and exists(select 1 from jsonb_array_elements(v_settlements) s(value) where s.value->>'sourceId'=i.source_id))
    )
  ) then raise exception 'A different generation of this backup was already restored; restore updated full backups only into an empty account'; end if;

  if v_schema in ('dewu-seller-pro/ledger-backup@1','dewu-seller-pro/ledger-backup@2') then
    return public.restore_ledger_backup_core_v3(p_user_id,p_operation_id,p_package,p_dry_run);
  end if;
  perform public.assert_settlement_backup_v3(p_package);

  select count(*) into v_removed_settlements from jsonb_array_elements(p_package#>'{data,settlements}') s(value)
  where exists(select 1 from public.activities a where a.user_id=p_user_id and a.id=s.value->>'activitySourceId')
    or exists(select 1 from public.ledger_restore_items i join public.activities a on a.user_id=i.user_id and a.id=i.target_id
      where i.user_id=p_user_id and i.entity_type='activity' and i.source_id=s.value->>'activitySourceId');
  if v_removed_settlements>0 then
    v_filtered:=jsonb_set(v_filtered,'{data,settlements}',coalesce((select jsonb_agg(s.value) from jsonb_array_elements(p_package#>'{data,settlements}') s(value)
      where not exists(select 1 from public.activities a where a.user_id=p_user_id and a.id=s.value->>'activitySourceId')
        and not exists(select 1 from public.ledger_restore_items i join public.activities a on a.user_id=i.user_id and a.id=i.target_id
          where i.user_id=p_user_id and i.entity_type='activity' and i.source_id=s.value->>'activitySourceId')),'[]'::jsonb));
    v_filtered:=jsonb_set(v_filtered,'{counts,settlements}',to_jsonb(jsonb_array_length(v_filtered#>'{data,settlements}')));
    v_filtered:=jsonb_set(v_filtered,'{data,activities}',coalesce((select jsonb_agg(
      case when mapped.target_id is not null then a.value||jsonb_build_object('sourceId',mapped.target_id,'actualPlatformFee',null,'actualNetProceeds',null,'actualNetProfit',null,'settledAt',null,'settlementOrderNo','','settlementNote','','settlementRevision',0) else a.value end
    ) from jsonb_array_elements(p_package#>'{data,activities}') a(value)
    left join lateral (
      select target_id from (
        select current_activity.id as target_id,0 as priority from public.activities current_activity where current_activity.user_id=p_user_id and current_activity.id=a.value->>'sourceId'
        union all
        select i.target_id,1 from public.ledger_restore_items i join public.activities current_activity on current_activity.user_id=i.user_id and current_activity.id=i.target_id
          where i.user_id=p_user_id and i.entity_type='activity' and i.source_id=a.value->>'sourceId'
      ) candidates order by priority limit 1
    ) mapped on true),'[]'::jsonb));
    v_filtered:=jsonb_set(v_filtered,'{data,repairs}',coalesce((select jsonb_agg(
      case when r.value->>'targetTable'='activities' and mapped.target_id is not null then jsonb_set(r.value,'{recordId}',to_jsonb(mapped.target_id)) else r.value end
    ) from jsonb_array_elements(p_package#>'{data,repairs}') r(value)
    left join lateral (
      select target_id from (
        select current_activity.id as target_id,0 as priority from public.activities current_activity where current_activity.user_id=p_user_id and current_activity.id=r.value->>'recordId'
        union all
        select i.target_id,1 from public.ledger_restore_items i join public.activities current_activity on current_activity.user_id=i.user_id and current_activity.id=i.target_id
          where i.user_id=p_user_id and i.entity_type='activity' and i.source_id=r.value->>'recordId'
      ) candidates order by priority limit 1
    ) mapped on true),'[]'::jsonb));
  end if;
  v_filtered_fingerprint:=encode(extensions.digest(convert_to(v_filtered::text,'UTF8'),'sha256'),'hex');

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

  v_result:=public.restore_ledger_backup_core_v3(p_user_id,'v3-'||substr(encode(extensions.digest(convert_to(p_operation_id,'UTF8'),'sha256'),'hex'),1,48),v_filtered,p_dry_run);
  v_result:=jsonb_set(v_result,'{packageHash}',to_jsonb(p_package#>>'{integrity,value}'));
  v_result:=jsonb_set(v_result,'{payloadFingerprint}',to_jsonb(v_fingerprint));
  v_result:=jsonb_set(v_result,'{operationId}',case when p_dry_run then 'null'::jsonb else to_jsonb(p_operation_id) end);
  v_result:=jsonb_set(v_result,'{skipped}',to_jsonb((v_result->>'skipped')::integer+v_removed_settlements));
  if not p_dry_run then
    update public.outbound_settlement_audit a set settlement_snapshot=jsonb_set(a.settlement_snapshot,'{activityId}',to_jsonb(a.activity_id))
    where a.user_id=p_user_id and exists(select 1 from public.ledger_restore_items i where i.user_id=p_user_id and i.payload_fingerprint=v_filtered_fingerprint and i.entity_type='settlement' and i.target_id=a.id::text);
    update public.ledger_restore_operations set result=v_result where user_id=p_user_id and operation_id=p_operation_id;
  end if;
  return v_result;
end;
$$;

revoke all on function public.restore_ledger_backup(uuid,text,jsonb,boolean) from public,anon;
grant execute on function public.restore_ledger_backup(uuid,text,jsonb,boolean) to authenticated;

commit;
