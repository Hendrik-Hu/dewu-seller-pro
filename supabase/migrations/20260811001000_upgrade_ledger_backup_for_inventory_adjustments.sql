begin;

alter table public.ledger_restore_items drop constraint if exists ledger_restore_items_entity_type_check;
alter table public.ledger_restore_items add constraint ledger_restore_items_entity_type_check
  check (entity_type in ('warehouse','product','activity','repair','fee_scheme','settlement','inventory_adjustment'));
alter table public.ledger_restore_quarantine drop constraint if exists ledger_restore_quarantine_entity_type_check;
alter table public.ledger_restore_quarantine add constraint ledger_restore_quarantine_entity_type_check
  check (entity_type in ('warehouse','product','activity','repair','fee_scheme','settlement','inventory_adjustment'));

alter function public.restore_ledger_backup(uuid, text, jsonb, boolean)
  rename to restore_ledger_backup_pre_adjustment_v12;
revoke all on function public.restore_ledger_backup_pre_adjustment_v12(uuid, text, jsonb, boolean)
  from public, anon, authenticated;

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
  v_fingerprint text := encode(extensions.digest(convert_to(p_package::text, 'UTF8'), 'sha256'), 'hex');
  v_filtered jsonb;
  v_result jsonb;
  v_existing_result jsonb;
  v_existing_fingerprint text;
  v_adjustments jsonb;
  v_row jsonb;
  v_source_id text;
  v_product_source_id text;
  v_target_product_id text;
  v_target_audit_id uuid;
  v_old_stock integer;
  v_new_stock integer;
  v_old_cost numeric(12,2);
  v_new_cost numeric(12,2);
  v_old_status text;
  v_new_status text;
  v_reason text;
  v_created_at timestamptz;
  v_operation_id text;
  v_request_hash text;
  v_added integer := 0;
  v_skipped integer := 0;
  v_conflicts integer := 0;
  v_details jsonb := '[]'::jsonb;
  v_details_truncated boolean := false;
  v_seen text[] := array[]::text[];
  v_index integer := 0;
  v_reason_conflict text;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if jsonb_typeof(p_package) is distinct from 'object' then raise exception 'Ledger backup package must be an object'; end if;
  if octet_length(convert_to(p_package::text, 'UTF8')) > 26214400 then raise exception 'Ledger backup package exceeds 25 MB'; end if;
  if exists (
    select 1 from jsonb_object_keys(p_package) key
    where key not in ('schemaVersion','exportedAt','scope','counts','media','data','integrity')
  ) then raise exception 'Ledger backup package contains unknown top-level fields'; end if;
  if jsonb_typeof(p_package->'data') is distinct from 'object'
    or exists (
      select 1 from jsonb_object_keys(p_package->'data') key
      where key not in ('products','activities','warehouses','repairs','feeSchemes','settlements','inventoryAdjustments')
    ) then raise exception 'Ledger backup data contains unknown fields'; end if;
  if jsonb_typeof(p_package->'counts') is distinct from 'object'
    or exists (
      select 1 from jsonb_object_keys(p_package->'counts') key
      where key not in ('products','activeProducts','recycledProducts','activities','warehouses','repairs','feeSchemes','settlements','inventoryAdjustments')
    ) then raise exception 'Ledger backup counts contain unknown fields'; end if;
  if v_schema in (
    'dewu-seller-pro/ledger-backup@1',
    'dewu-seller-pro/ledger-backup@2',
    'dewu-seller-pro/ledger-backup@3'
  ) then
    if not p_dry_run then
      perform pg_advisory_xact_lock(hashtextextended('ledger-restore:' || p_user_id::text, 0));
    end if;
    return public.restore_ledger_backup_pre_adjustment_v12(p_user_id, p_operation_id, p_package, p_dry_run);
  end if;
  if v_schema <> 'dewu-seller-pro/ledger-backup@4' then raise exception 'Unsupported ledger backup schema'; end if;
  if jsonb_typeof(p_package#>'{data,inventoryAdjustments}') is distinct from 'array' then
    raise exception 'Inventory adjustments must be an array';
  end if;
  v_adjustments := p_package#>'{data,inventoryAdjustments}';
  if jsonb_array_length(v_adjustments) > 50000 then raise exception 'Too many inventory adjustments'; end if;
  if (p_package#>>'{counts,inventoryAdjustments}') is null
    or (p_package#>>'{counts,inventoryAdjustments}')::integer <> jsonb_array_length(v_adjustments) then
    raise exception 'Inventory adjustment count mismatch';
  end if;
  if char_length(coalesce(p_operation_id, '')) not between 8 and 120 then raise exception 'Restore operation id is invalid'; end if;

  -- Execute the exact same write path inside a subtransaction and force rollback.
  -- PL/pgSQL variables retain the returned result while all table changes roll back.
  if p_dry_run then
    begin
      v_result := public.restore_ledger_backup(p_user_id, p_operation_id, p_package, false);
      raise exception using errcode = 'RV012', message = 'ledger restore preview rollback';
    exception when sqlstate 'RV012' then
      v_result := jsonb_set(v_result, '{dryRun}', 'true'::jsonb);
      v_result := jsonb_set(v_result, '{operationId}', 'null'::jsonb);
      return v_result;
    end;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ledger-restore:' || p_user_id::text, 0));

  if not exists (
    select 1 from public.ledger_restore_operations
    where user_id = p_user_id and payload_fingerprint = v_fingerprint and result is not null
  ) and exists (
    select 1
    from public.ledger_restore_items item
    where item.user_id = p_user_id
      and item.entity_type = 'inventory_adjustment'
      and item.payload_fingerprint <> v_fingerprint
      and exists (
        select 1 from jsonb_array_elements(v_adjustments) adjustment(value)
        where jsonb_typeof(adjustment.value) = 'object'
          and adjustment.value->>'sourceId' = item.source_id
      )
  ) then
    raise exception 'A different generation of this backup was already restored; restore updated full backups only into an empty account';
  end if;

  if not p_dry_run then
    insert into public.ledger_restore_operations(user_id, operation_id, client_hash, payload_fingerprint)
    values (p_user_id, p_operation_id, coalesce(p_package#>>'{integrity,value}', ''), v_fingerprint)
    on conflict do nothing;
    if not found then
      select payload_fingerprint, result into v_existing_fingerprint, v_existing_result
      from public.ledger_restore_operations where user_id = p_user_id and operation_id = p_operation_id;
      if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'Restore operation payload does not match original package'; end if;
      if v_existing_result is null then raise exception 'Restore operation is still processing'; end if;
      return v_existing_result;
    end if;
  end if;

  v_filtered := jsonb_set(p_package, '{schemaVersion}', to_jsonb('dewu-seller-pro/ledger-backup@3'::text));
  v_filtered := v_filtered #- '{data,inventoryAdjustments}';
  v_filtered := v_filtered #- '{counts,inventoryAdjustments}';
  v_result := public.restore_ledger_backup_pre_adjustment_v12(
    p_user_id,
    'v12-' || substr(encode(extensions.digest(convert_to(p_operation_id, 'UTF8'), 'sha256'), 'hex'), 1, 48),
    v_filtered,
    p_dry_run
  );

  for v_row in select value from jsonb_array_elements(v_adjustments)
  loop
    v_index := v_index + 1;
    v_reason_conflict := null;
    v_target_product_id := null;
    v_source_id := case when jsonb_typeof(v_row) = 'object' then btrim(coalesce(v_row->>'sourceId', '')) else 'invalid-' || v_index::text end;

    begin
      if jsonb_typeof(v_row) is distinct from 'object' then raise exception '记录不是对象'; end if;
      if exists (
        select 1 from jsonb_object_keys(v_row) key
        where key not in ('sourceId','operationId','productSourceId','sku','size','warehouse','oldStock','newStock','oldCost','newCost','oldStatus','newStatus','reason','createdAt')
      ) then raise exception '盘点记录包含未知字段'; end if;
      if jsonb_typeof(v_row->'sourceId') is distinct from 'string'
        or jsonb_typeof(v_row->'operationId') is distinct from 'string'
        or jsonb_typeof(v_row->'productSourceId') is distinct from 'string'
        or jsonb_typeof(v_row->'sku') is distinct from 'string'
        or jsonb_typeof(v_row->'size') is distinct from 'string'
        or jsonb_typeof(v_row->'warehouse') is distinct from 'string'
        or jsonb_typeof(v_row->'oldStock') is distinct from 'number'
        or jsonb_typeof(v_row->'newStock') is distinct from 'number'
        or jsonb_typeof(v_row->'oldCost') is distinct from 'number'
        or jsonb_typeof(v_row->'newCost') is distinct from 'number'
        or jsonb_typeof(v_row->'oldStatus') is distinct from 'string'
        or jsonb_typeof(v_row->'newStatus') is distinct from 'string'
        or jsonb_typeof(v_row->'reason') is distinct from 'string'
        or jsonb_typeof(v_row->'createdAt') is distinct from 'string' then
        raise exception '盘点记录字段类型无效';
      end if;
      if char_length(v_source_id) not between 1 and 200 then raise exception '记录标识无效'; end if;
      if v_source_id = any(v_seen) then raise exception '账本包内盘点记录 sourceId 重复'; end if;
      v_seen := array_append(v_seen, v_source_id);
      v_product_source_id := btrim(coalesce(v_row->>'productSourceId', ''));
      v_operation_id := btrim(coalesce(v_row->>'operationId', ''));
      v_reason := btrim(coalesce(v_row->>'reason', ''));
      if char_length(v_product_source_id) not between 1 and 200
        or char_length(v_operation_id) not between 8 and 120
        or char_length(v_reason) not between 4 and 500
        or char_length(v_row->>'sku') not between 1 and 120
        or char_length(v_row->>'size') not between 1 and 40
        or char_length(v_row->>'warehouse') not between 1 and 60 then raise exception '关联商品、操作号或文本字段无效'; end if;
      v_old_stock := (v_row->>'oldStock')::integer;
      v_new_stock := (v_row->>'newStock')::integer;
      v_old_cost := round((v_row->>'oldCost')::numeric, 2);
      v_new_cost := round((v_row->>'newCost')::numeric, 2);
      v_old_status := v_row->>'oldStatus';
      v_new_status := v_row->>'newStatus';
      v_created_at := (v_row->>'createdAt')::timestamptz;
      if v_old_stock < 0 or v_new_stock < 0 or v_old_stock > 1000000 or v_new_stock > 1000000
        or v_old_cost < 0 or v_new_cost < 0 or v_old_cost > 1000000 or v_new_cost > 1000000
        or v_old_cost::text in ('NaN','Infinity','-Infinity') or v_new_cost::text in ('NaN','Infinity','-Infinity')
        or v_old_status not in ('instock','shipping','sold','flaw')
        or v_new_status not in ('instock','shipping','sold','flaw')
        or v_created_at < timestamptz '2000-01-01' or v_created_at > now() + interval '1 day' then
        raise exception '库存、成本、状态或时间无效';
      end if;
    exception when others then
      v_reason_conflict := sqlerrm;
    end;

    if v_reason_conflict is null and (
      exists (select 1 from public.inventory_adjustment_audit where user_id = p_user_id and id::text = v_source_id)
      or exists (select 1 from public.ledger_restore_items where user_id = p_user_id and payload_fingerprint = v_fingerprint and entity_type = 'inventory_adjustment' and source_id = v_source_id)
    ) then
      v_skipped := v_skipped + 1;
    elsif v_reason_conflict is null then
      select product.id into v_target_product_id
      from public.products product
      where product.user_id = p_user_id and product.id = v_product_source_id
      limit 1;
      if v_target_product_id is null then
        select item.target_id into v_target_product_id
        from public.ledger_restore_items item
        join public.products product on product.user_id = item.user_id and product.id = item.target_id
        where item.user_id = p_user_id and item.entity_type = 'product' and item.source_id = v_product_source_id
        order by item.restored_at desc limit 1;
      end if;
      if v_target_product_id is null then v_reason_conflict := '盘点目标商品未恢复，历史快照已隔离'; end if;
    end if;

    if v_reason_conflict is not null then
      v_conflicts := v_conflicts + 1;
      if not p_dry_run then
        insert into public.ledger_restore_quarantine(user_id,payload_fingerprint,entity_type,source_id,payload,reason)
        values(p_user_id,v_fingerprint,'inventory_adjustment',v_source_id,v_row,v_reason_conflict)
        on conflict do nothing;
      end if;
      if jsonb_array_length(v_details) < 100 then
        v_details := v_details || jsonb_build_array(jsonb_build_object('entity','inventory_adjustment','sourceId',v_source_id,'outcome','conflict','reason',v_reason_conflict));
      else v_details_truncated := true; end if;
    elsif not (
      exists (select 1 from public.inventory_adjustment_audit where user_id = p_user_id and id::text = v_source_id)
      or exists (select 1 from public.ledger_restore_items where user_id = p_user_id and payload_fingerprint = v_fingerprint and entity_type = 'inventory_adjustment' and source_id = v_source_id)
    ) then
      v_added := v_added + 1;
      if not p_dry_run then
        v_request_hash := encode(extensions.digest(convert_to(v_row::text, 'UTF8'), 'sha256'), 'hex');
        insert into public.inventory_adjustment_audit(
          user_id,operation_id,request_hash,product_id,sku,size,warehouse,
          old_stock,new_stock,old_cost,new_cost,old_status,new_status,reason,created_at
        ) values (
          p_user_id,
          'restore-adjust:' || substr(v_fingerprint,1,16) || ':' || substr(encode(extensions.digest(convert_to(v_source_id,'UTF8'),'sha256'),'hex'),1,32),
          v_request_hash,v_target_product_id,btrim(coalesce(v_row->>'sku','')),btrim(coalesce(v_row->>'size','')),
          btrim(coalesce(v_row->>'warehouse','')),v_old_stock,v_new_stock,v_old_cost,v_new_cost,
          v_old_status,v_new_status,v_reason,v_created_at
        ) returning id into v_target_audit_id;
        insert into public.ledger_restore_items(user_id,payload_fingerprint,entity_type,source_id,target_id)
        values(p_user_id,v_fingerprint,'inventory_adjustment',v_source_id,v_target_audit_id::text);
      end if;
    end if;
  end loop;

  v_result := jsonb_set(v_result, '{packageHash}', to_jsonb(coalesce(p_package#>>'{integrity,value}', '')));
  v_result := jsonb_set(v_result, '{payloadFingerprint}', to_jsonb(v_fingerprint));
  v_result := jsonb_set(v_result, '{operationId}', case when p_dry_run then 'null'::jsonb else to_jsonb(p_operation_id) end);
  v_result := jsonb_set(v_result, '{added}', to_jsonb(coalesce((v_result->>'added')::integer,0) + v_added));
  v_result := jsonb_set(v_result, '{skipped}', to_jsonb(coalesce((v_result->>'skipped')::integer,0) + v_skipped));
  v_result := jsonb_set(v_result, '{conflicts}', to_jsonb(coalesce((v_result->>'conflicts')::integer,0) + v_conflicts));
  v_result := jsonb_set(v_result, '{details}', coalesce(v_result->'details','[]'::jsonb) || v_details);
  if jsonb_array_length(v_result->'details') > 100 then
    v_result := jsonb_set(v_result, '{details}', (select coalesce(jsonb_agg(value),'[]'::jsonb) from (select value from jsonb_array_elements(v_result->'details') limit 100) limited));
    v_details_truncated := true;
  end if;
  v_result := jsonb_set(v_result, '{detailsTruncated}', to_jsonb(coalesce((v_result->>'detailsTruncated')::boolean,false) or v_details_truncated));
  if not p_dry_run then
    update public.ledger_restore_operations set result = v_result
    where user_id = p_user_id and operation_id = p_operation_id;
  end if;
  return v_result;
end;
$$;

revoke all on function public.restore_ledger_backup(uuid,text,jsonb,boolean) from public,anon;
grant execute on function public.restore_ledger_backup(uuid,text,jsonb,boolean) to authenticated;

commit;
