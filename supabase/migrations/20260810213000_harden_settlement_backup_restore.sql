begin;

create or replace function public.assert_settlement_backup_v3(p_package jsonb)
returns void language plpgsql set search_path=public,pg_temp as $$
declare
  v_activity jsonb;
  v_row jsonb;
  v_previous jsonb;
  v_last jsonb;
  v_source text;
  v_revision integer;
  v_index integer;
  v_quantity integer;
  v_price numeric;
  v_cost numeric;
  v_gross numeric;
  v_fee numeric;
  v_net numeric;
  v_profit numeric;
  v_created timestamptz;
  v_settled timestamptz;
  v_expected_rows integer:=0;
begin
  for v_activity in select value from jsonb_array_elements(p_package#>'{data,activities}') loop
    begin
      v_source:=trim(v_activity->>'sourceId');
      v_revision:=(v_activity->>'settlementRevision')::integer;
      v_quantity:=case when v_activity->'count'='null'::jsonb then 1 else (v_activity->>'count')::integer end;
      v_price:=(v_activity->>'price')::numeric;
      v_cost:=case when v_activity->'cost'='null'::jsonb then null else (v_activity->>'cost')::numeric end;
      v_created:=(v_activity->>'createdAt')::timestamptz;
      if v_source='' or v_revision<0 or v_quantity<=0 or v_price<0 then raise exception 'value'; end if;
      if v_revision=0 then
        if v_activity->'actualPlatformFee'<>'null'::jsonb or v_activity->'actualNetProceeds'<>'null'::jsonb
          or v_activity->'actualNetProfit'<>'null'::jsonb or v_activity->'settledAt'<>'null'::jsonb
          or coalesce(v_activity->>'settlementOrderNo','')<>'' or coalesce(v_activity->>'settlementNote','')<>''
        then raise exception 'zero revision contains settlement'; end if;
      else
        if v_activity->>'type'<>'outbound' then raise exception 'non-outbound settlement'; end if;
        v_expected_rows:=v_expected_rows+v_revision;
        v_gross:=round(v_price*v_quantity,2);
        v_previous:=null;
        for v_index in 1..v_revision loop
          select value into v_row from jsonb_array_elements(p_package#>'{data,settlements}')
          where value->>'activitySourceId'=v_source and (value->>'revision')::integer=v_index;
          if v_row is null then raise exception 'missing revision'; end if;
          v_last:=v_row->'settlementSnapshot';
          if jsonb_typeof(v_last)<>'object' or not (v_last ?& array['schemaVersion','activityId','revision','quantity','grossAmount','frozenUnitCost','actualPlatformFee','actualNetProceeds','actualNetProfit','settledAt','orderNo','note'])
            or jsonb_typeof(v_last->'schemaVersion')<>'string' or jsonb_typeof(v_last->'activityId')<>'string'
            or jsonb_typeof(v_last->'revision')<>'number' or jsonb_typeof(v_last->'quantity')<>'number' or jsonb_typeof(v_last->'grossAmount')<>'number'
            or jsonb_typeof(v_last->'frozenUnitCost') not in ('number','null') or jsonb_typeof(v_last->'actualPlatformFee')<>'number'
            or jsonb_typeof(v_last->'actualNetProceeds')<>'number' or jsonb_typeof(v_last->'actualNetProfit') not in ('number','null')
            or jsonb_typeof(v_last->'settledAt')<>'string' or jsonb_typeof(v_last->'orderNo') not in ('string','null') or jsonb_typeof(v_last->'note') not in ('string','null')
            or v_last->>'schemaVersion'<>'outbound-settlement@1' or v_last->>'activityId'<>v_source
            or (v_last->>'revision')::integer<>v_index or (v_last->>'quantity')::integer<>v_quantity
            or round((v_last->>'grossAmount')::numeric,2)<>v_gross
            or ((v_cost is null)<>(v_last->'frozenUnitCost'='null'::jsonb))
            or (v_cost is not null and round((v_last->>'frozenUnitCost')::numeric,2)<>round(v_cost,2))
          then raise exception 'snapshot identity'; end if;
          v_fee:=round((v_last->>'actualPlatformFee')::numeric,2);
          v_net:=round((v_last->>'actualNetProceeds')::numeric,2);
          v_profit:=case when v_last->'actualNetProfit'='null'::jsonb then null else round((v_last->>'actualNetProfit')::numeric,2) end;
          v_settled:=(v_last->>'settledAt')::timestamptz;
          if v_fee<0 or v_fee>1000000 or v_net<>round(v_gross-v_fee,2) or v_settled<v_created
            or (v_cost is null and v_profit is not null)
            or (v_cost is not null and v_profit<>round(v_net-v_cost*v_quantity,2))
            or length(coalesce(v_last->>'orderNo',''))>100 or length(coalesce(v_last->>'note',''))>500
          then raise exception 'snapshot calculation'; end if;
          if v_index=1 and v_row->'previousSnapshot'<>'null'::jsonb then raise exception 'first previous'; end if;
          if v_index>1 then
            if jsonb_typeof(v_row->'previousSnapshot')<>'object'
              or not ((v_row->'previousSnapshot') ?& array['actualPlatformFee','actualNetProceeds','actualNetProfit','settledAt','orderNo','note','revision'])
              or jsonb_typeof(v_row#>'{previousSnapshot,actualPlatformFee}')<>'number' or jsonb_typeof(v_row#>'{previousSnapshot,actualNetProceeds}')<>'number'
              or jsonb_typeof(v_row#>'{previousSnapshot,actualNetProfit}') not in ('number','null') or jsonb_typeof(v_row#>'{previousSnapshot,settledAt}')<>'string'
              or jsonb_typeof(v_row#>'{previousSnapshot,orderNo}') not in ('string','null') or jsonb_typeof(v_row#>'{previousSnapshot,note}') not in ('string','null')
              or jsonb_typeof(v_row#>'{previousSnapshot,revision}')<>'number'
              or round((v_row#>>'{previousSnapshot,actualPlatformFee}')::numeric,2)<>round((v_previous->>'actualPlatformFee')::numeric,2)
              or round((v_row#>>'{previousSnapshot,actualNetProceeds}')::numeric,2)<>round((v_previous->>'actualNetProceeds')::numeric,2)
              or ((v_row#>'{previousSnapshot,actualNetProfit}'='null'::jsonb)<>(v_previous->'actualNetProfit'='null'::jsonb))
              or (v_previous->'actualNetProfit'<>'null'::jsonb and round((v_row#>>'{previousSnapshot,actualNetProfit}')::numeric,2)<>round((v_previous->>'actualNetProfit')::numeric,2))
              or (v_row#>>'{previousSnapshot,settledAt}')::timestamptz<>(v_previous->>'settledAt')::timestamptz
              or coalesce(v_row#>>'{previousSnapshot,orderNo}','')<>coalesce(v_previous->>'orderNo','')
              or coalesce(v_row#>>'{previousSnapshot,note}','')<>coalesce(v_previous->>'note','')
              or (v_row#>>'{previousSnapshot,revision}')::integer<>v_index-1
            then raise exception 'previous chain'; end if;
          end if;
          v_previous:=v_last;
        end loop;
        if round((v_activity->>'actualPlatformFee')::numeric,2)<>round((v_last->>'actualPlatformFee')::numeric,2)
          or round((v_activity->>'actualNetProceeds')::numeric,2)<>round((v_last->>'actualNetProceeds')::numeric,2)
          or ((v_activity->'actualNetProfit'='null'::jsonb)<>(v_last->'actualNetProfit'='null'::jsonb))
          or (v_last->'actualNetProfit'<>'null'::jsonb and round((v_activity->>'actualNetProfit')::numeric,2)<>round((v_last->>'actualNetProfit')::numeric,2))
          or (v_activity->>'settledAt')::timestamptz<>(v_last->>'settledAt')::timestamptz
          or coalesce(v_activity->>'settlementOrderNo','')<>coalesce(v_last->>'orderNo','')
          or coalesce(v_activity->>'settlementNote','')<>coalesce(v_last->>'note','')
        then raise exception 'current snapshot mismatch'; end if;
      end if;
    exception when others then raise exception 'Settlement chain is invalid for activity %',left(coalesce(v_source,'unknown'),80); end;
  end loop;
  if v_expected_rows<>jsonb_array_length(p_package#>'{data,settlements}') then raise exception 'Settlement audit contains orphan or extra revisions'; end if;
end;
$$;
revoke all on function public.assert_settlement_backup_v3(jsonb) from public,anon,authenticated;

do $$ begin
  if to_regprocedure('public.restore_ledger_backup_core_v3(uuid,text,jsonb,boolean)') is null then
    alter function public.restore_ledger_backup(uuid,text,jsonb,boolean) rename to restore_ledger_backup_core_v3;
  end if;
end $$;
revoke all on function public.restore_ledger_backup_core_v3(uuid,text,jsonb,boolean) from public,anon,authenticated;

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
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if v_schema in ('dewu-seller-pro/ledger-backup@1','dewu-seller-pro/ledger-backup@2') then
    return public.restore_ledger_backup_core_v3(p_user_id,p_operation_id,p_package,p_dry_run);
  end if;
  if v_schema<>'dewu-seller-pro/ledger-backup@3' then raise exception 'Unsupported ledger backup schema'; end if;
  perform public.assert_settlement_backup_v3(p_package);
  if not exists(select 1 from public.ledger_restore_operations where user_id=p_user_id and payload_fingerprint=v_fingerprint and result is not null) and exists(
    select 1 from public.ledger_restore_items i where i.user_id=p_user_id and i.payload_fingerprint<>v_fingerprint and (
      (i.entity_type='activity' and exists(select 1 from jsonb_array_elements(p_package#>'{data,activities}') a(value) where a.value->>'sourceId'=i.source_id))
      or (i.entity_type='product' and exists(select 1 from jsonb_array_elements(p_package#>'{data,products}') p(value) where p.value->>'sourceId'=i.source_id))
      or (i.entity_type='warehouse' and exists(select 1 from jsonb_array_elements(p_package#>'{data,warehouses}') w(value) where w.value->>'sourceId'=i.source_id))
      or (i.entity_type='repair' and exists(select 1 from jsonb_array_elements(p_package#>'{data,repairs}') r(value) where r.value->>'sourceId'=i.source_id))
      or (i.entity_type='fee_scheme' and exists(select 1 from jsonb_array_elements(p_package#>'{data,feeSchemes}') f(value) where f.value->>'sourceId'=i.source_id))
      or (i.entity_type='settlement' and exists(select 1 from jsonb_array_elements(p_package#>'{data,settlements}') s(value) where s.value->>'sourceId'=i.source_id))
    )
  ) then raise exception 'A different generation of this backup was already restored; restore updated full backups only into an empty account'; end if;

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
