begin;

alter table public.data_repair_audit
  add column if not exists old_status text,
  add column if not exists new_status text;

drop function if exists public.repair_inventory_anomaly(uuid, text, text, numeric, text);

create or replace function public.repair_inventory_anomaly(
  p_user_id uuid,
  p_target_table text,
  p_record_id text,
  p_new_value numeric,
  p_reason text,
  p_target_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_value numeric;
  v_field_name text;
  v_audit_id uuid;
  v_old_status text;
  v_new_status text;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if p_new_value is null or p_new_value <> trunc(p_new_value) then raise exception 'Corrected value must be an integer'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Repair reason is required'; end if;

  if p_target_table = 'products' then
    if p_new_value < 0 then raise exception 'Stock must be greater than or equal to 0'; end if;
    if p_target_status not in ('instock', 'shipping', 'sold', 'flaw') then raise exception 'Target product status is required'; end if;
    if p_new_value > 0 and p_target_status = 'sold' then raise exception 'Positive stock cannot use sold status'; end if;
    if p_new_value = 0 and p_target_status <> 'sold' then raise exception 'Zero stock must use sold status'; end if;

    select stock, status into v_old_value, v_old_status
    from public.products
    where id = p_record_id and user_id = p_user_id
    for update;
    if not found then raise exception 'Product not found'; end if;
    if v_old_value is null or v_old_value >= 0 then raise exception 'Product stock is not anomalous'; end if;

    v_new_status := p_target_status;
    update public.products
    set stock = p_new_value::integer, status = v_new_status
    where id = p_record_id and user_id = p_user_id;
    v_field_name := 'stock';
  elsif p_target_table = 'activities' then
    if p_target_status is not null then raise exception 'Activity repair does not accept product status'; end if;
    if p_new_value <= 0 then raise exception 'Activity quantity must be greater than 0'; end if;
    select count into v_old_value
    from public.activities
    where id = p_record_id and user_id = p_user_id
    for update;
    if not found then raise exception 'Activity not found'; end if;
    if v_old_value is null or v_old_value > 0 then raise exception 'Activity quantity is not anomalous'; end if;
    update public.activities set count = p_new_value where id = p_record_id and user_id = p_user_id;
    v_field_name := 'count';
  else
    raise exception 'Unsupported repair target';
  end if;

  insert into public.data_repair_audit (
    user_id, target_table, record_id, field_name, old_value, new_value,
    old_status, new_status, reason
  ) values (
    p_user_id, p_target_table, p_record_id, v_field_name, v_old_value, p_new_value,
    v_old_status, v_new_status, trim(p_reason)
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'audit_id', v_audit_id,
    'target_table', p_target_table,
    'record_id', p_record_id,
    'field_name', v_field_name,
    'old_value', v_old_value,
    'new_value', p_new_value,
    'old_status', v_old_status,
    'new_status', v_new_status
  );
end;
$$;

revoke all on function public.repair_inventory_anomaly(uuid, text, text, numeric, text, text) from public, anon;
grant execute on function public.repair_inventory_anomaly(uuid, text, text, numeric, text, text) to authenticated;

commit;
