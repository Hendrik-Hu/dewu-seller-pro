begin;

alter function public.restore_ledger_backup(uuid, text, jsonb, boolean)
  rename to restore_ledger_backup_pre_order_validation_v23;

revoke all on function public.restore_ledger_backup_pre_order_validation_v23(uuid, text, jsonb, boolean)
  from public, anon, authenticated;

create or replace function public.restore_ledger_backup(
  p_user_id uuid,
  p_operation_id text,
  p_package jsonb,
  p_dry_run boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_schema text := p_package->>'schemaVersion';
  v_row jsonb;
  v_statuses constant text[] := array[
    'pending_shipment','shipped','authenticating','authenticated','settled',
    'canceled','auth_failed','returning','returned','refunded'
  ];
  v_from_status text;
  v_linked_order_id uuid;
  v_source_order_id text;
  v_source_activity_id text;
  v_optional_time text;
  v_time timestamptz;
  v_amount numeric;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Unauthorized restore request';
  end if;

  if v_schema <> 'dewu-seller-pro/ledger-backup@5' then
    return public.restore_ledger_backup_pre_order_validation_v23(
      p_user_id, p_operation_id, p_package, p_dry_run
    );
  end if;

  for v_row in select value from jsonb_array_elements(p_package#>'{data,salesOrders}') loop
    if octet_length(convert_to(v_row::text, 'UTF8')) > 131072 then
      raise exception '销售订单单条快照超过 128 KB 上限';
    end if;

    foreach v_optional_time in array array[
      'shippedAt','authenticationStartedAt','authenticatedAt','settledAt',
      'canceledAt','returnStartedAt','returnedAt','refundedAt'
    ] loop
      if v_row->v_optional_time is not null and v_row->v_optional_time <> 'null'::jsonb then
        if jsonb_typeof(v_row->v_optional_time) <> 'string' then
          raise exception '销售订单时间字段类型无效';
        end if;
        v_time := nullif(v_row->>v_optional_time, '')::timestamptz;
        if v_time is not null and (v_time < timestamptz '2000-01-01' or v_time > now() + interval '1 day') then
          raise exception '销售订单时间字段超出允许范围';
        end if;
      end if;
    end loop;

    foreach v_optional_time in array array[
      'estimatedPlatformFee','estimatedNetProceeds','estimatedNetProfit'
    ] loop
      if v_row->v_optional_time is not null and v_row->v_optional_time <> 'null'::jsonb then
        if jsonb_typeof(v_row->v_optional_time) <> 'number' then
          raise exception '销售订单估算金额类型无效';
        end if;
        v_amount := (v_row->>v_optional_time)::numeric;
        if abs(v_amount) > 1000000000
          or (v_optional_time = 'estimatedPlatformFee' and v_amount < 0) then
          raise exception '销售订单估算金额超出允许范围';
        end if;
      end if;
    end loop;

    v_source_order_id := btrim(coalesce(v_row->>'sourceId', ''));
    v_source_activity_id := btrim(coalesce(v_row->>'outboundActivitySourceId', ''));
    if v_source_activity_id <> '' then
      select sales_order_id into v_linked_order_id
      from public.activities
      where user_id = p_user_id and id = v_source_activity_id
      limit 1;

      if v_linked_order_id is not null
        and not exists (
          select 1 from public.sales_orders
          where user_id = p_user_id
            and id = v_linked_order_id
            and id::text = v_source_order_id
        ) then
        raise exception '订单关联出库流水已被另一订单占用';
      end if;
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(p_package#>'{data,salesOrderEvents}') loop
    if jsonb_typeof(v_row) is distinct from 'object' then
      continue;
    end if;
    if octet_length(convert_to(v_row::text, 'UTF8')) > 131072 then
      raise exception '销售订单事件单条快照超过 128 KB 上限';
    end if;
    if exists (
      select 1 from jsonb_object_keys(v_row) key
      where key not in (
        'sourceId','orderSourceId','operationId','payloadFingerprint','action',
        'fromStatus','toStatus','details','result','createdAt'
      )
    ) then
      raise exception '销售订单事件包含未知字段';
    end if;
    if v_row->'fromStatus' is not null
      and jsonb_typeof(v_row->'fromStatus') not in ('string','null') then
      raise exception '销售订单事件起始状态类型无效';
    end if;
    v_from_status := nullif(btrim(coalesce(v_row->>'fromStatus', '')), '');
    if v_from_status is not null and not (v_from_status = any(v_statuses)) then
      raise exception '销售订单事件起始状态无效';
    end if;
    if not (coalesce(v_row->>'toStatus', '') = any(v_statuses)) then
      raise exception '销售订单事件目标状态无效';
    end if;
    if octet_length(convert_to(coalesce(v_row->'details', '{}'::jsonb)::text, 'UTF8')) > 65536
      or octet_length(convert_to(coalesce(v_row->'result', '{}'::jsonb)::text, 'UTF8')) > 65536 then
      raise exception '销售订单事件详情超过 64 KB 上限';
    end if;
  end loop;

  return public.restore_ledger_backup_pre_order_validation_v23(
    p_user_id, p_operation_id, p_package, p_dry_run
  );
end;
$$;

revoke all on function public.restore_ledger_backup(uuid, text, jsonb, boolean)
  from public, anon;
grant execute on function public.restore_ledger_backup(uuid, text, jsonb, boolean)
  to authenticated;

commit;
