begin;

create table if not exists public.data_repair_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_table text not null check (target_table in ('products', 'activities')),
  record_id text not null,
  field_name text not null check (field_name in ('stock', 'count')),
  old_value numeric not null,
  new_value numeric not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists data_repair_audit_user_created_idx
  on public.data_repair_audit (user_id, created_at desc);

alter table public.data_repair_audit enable row level security;
drop policy if exists data_repair_audit_select_own on public.data_repair_audit;
create policy data_repair_audit_select_own
  on public.data_repair_audit for select to authenticated
  using (auth.uid() = user_id);

revoke all on table public.data_repair_audit from public, anon, authenticated;
grant select on table public.data_repair_audit to authenticated;

create or replace function public.repair_inventory_anomaly(
  p_user_id uuid,
  p_target_table text,
  p_record_id text,
  p_new_value numeric,
  p_reason text
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
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if p_new_value is null or p_new_value <> trunc(p_new_value) then raise exception 'Corrected value must be an integer'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Repair reason is required'; end if;

  if p_target_table = 'products' then
    if p_new_value < 0 then raise exception 'Stock must be greater than or equal to 0'; end if;
    select stock into v_old_value
    from public.products
    where id = p_record_id and user_id = p_user_id
    for update;
    if not found then raise exception 'Product not found'; end if;
    if v_old_value is null or v_old_value >= 0 then raise exception 'Product stock is not anomalous'; end if;
    update public.products set stock = p_new_value::integer where id = p_record_id and user_id = p_user_id;
    v_field_name := 'stock';
  elsif p_target_table = 'activities' then
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
    user_id, target_table, record_id, field_name, old_value, new_value, reason
  ) values (
    p_user_id, p_target_table, p_record_id, v_field_name, v_old_value, p_new_value, trim(p_reason)
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'audit_id', v_audit_id,
    'target_table', p_target_table,
    'record_id', p_record_id,
    'field_name', v_field_name,
    'old_value', v_old_value,
    'new_value', p_new_value
  );
end;
$$;

revoke all on function public.repair_inventory_anomaly(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.repair_inventory_anomaly(uuid, text, text, numeric, text) to authenticated;

commit;
