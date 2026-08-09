begin;

alter table public.activities add column if not exists actual_platform_fee numeric(12,2);
alter table public.activities add column if not exists actual_net_proceeds numeric(12,2);
alter table public.activities add column if not exists actual_net_profit numeric(12,2);
alter table public.activities add column if not exists settled_at timestamptz;
alter table public.activities add column if not exists settlement_order_no text;
alter table public.activities add column if not exists settlement_note text;
alter table public.activities add column if not exists settlement_revision integer not null default 0;

alter table public.activities drop constraint if exists activities_actual_platform_fee_check;
alter table public.activities add constraint activities_actual_platform_fee_check check (actual_platform_fee is null or actual_platform_fee between 0 and 1000000);
alter table public.activities drop constraint if exists activities_actual_net_proceeds_check;
alter table public.activities add constraint activities_actual_net_proceeds_check check (actual_net_proceeds is null or abs(actual_net_proceeds) <= 9999999999.99);
alter table public.activities drop constraint if exists activities_settlement_revision_check;
alter table public.activities add constraint activities_settlement_revision_check check (settlement_revision >= 0);
alter table public.activities drop constraint if exists activities_settlement_text_check;
alter table public.activities add constraint activities_settlement_text_check check (length(coalesce(settlement_order_no,'')) <= 100 and length(coalesce(settlement_note,'')) <= 500);

create table if not exists public.outbound_settlement_audit (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id text not null references public.activities(id) on delete restrict,
  operation_id text not null,
  payload_fingerprint text not null,
  revision integer not null check (revision > 0),
  previous_snapshot jsonb,
  settlement_snapshot jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(user_id,operation_id),
  unique(user_id,activity_id,revision),
  check (length(operation_id) between 1 and 160),
  check (length(payload_fingerprint)=64)
);

alter table public.outbound_settlement_audit enable row level security;
drop policy if exists outbound_settlement_audit_select_own on public.outbound_settlement_audit;
create policy outbound_settlement_audit_select_own on public.outbound_settlement_audit for select to authenticated using (user_id=auth.uid());
revoke all on table public.outbound_settlement_audit from public, anon, authenticated;
grant select on table public.outbound_settlement_audit to authenticated;

create or replace function public.guard_outbound_fee_snapshot_update()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    if current_setting('app.allow_fee_snapshot_restore',true)='on' then return new; end if;
    if new.actual_platform_fee is not null or new.actual_net_proceeds is not null or new.actual_net_profit is not null
      or new.settled_at is not null or new.settlement_order_no is not null or new.settlement_note is not null
      or coalesce(new.settlement_revision,0)<>0 then
      raise exception 'Outbound settlement cannot be inserted without an audit record';
    end if;
    return new;
  end if;
  if current_setting('app.allow_fee_snapshot_restore',true)='on' then return new; end if;
  if old.fee_snapshot is distinct from new.fee_snapshot
    or old.estimated_platform_fee is distinct from new.estimated_platform_fee
    or old.estimated_net_proceeds is distinct from new.estimated_net_proceeds
    or old.estimated_net_profit is distinct from new.estimated_net_profit then
    raise exception 'Outbound fee estimate snapshot is immutable';
  end if;
  if current_setting('app.allow_outbound_settlement',true)='on' then return new; end if;
  if old.actual_platform_fee is distinct from new.actual_platform_fee
    or old.actual_net_proceeds is distinct from new.actual_net_proceeds
    or old.actual_net_profit is distinct from new.actual_net_profit
    or old.settled_at is distinct from new.settled_at
    or old.settlement_order_no is distinct from new.settlement_order_no
    or old.settlement_note is distinct from new.settlement_note
    or old.settlement_revision is distinct from new.settlement_revision then
    raise exception 'Outbound settlement must be changed through the settlement RPC';
  end if;
  return new;
end;
$$;

drop trigger if exists activities_guard_outbound_fee_snapshot on public.activities;
create trigger activities_guard_outbound_fee_snapshot before insert or update on public.activities
for each row execute function public.guard_outbound_fee_snapshot_update();

create or replace function public.settle_outbound_activity(
  p_user_id uuid,
  p_activity_id text,
  p_operation_id text,
  p_actual_platform_fee numeric,
  p_settled_at timestamptz,
  p_order_no text default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_activity public.activities%rowtype;
  v_fee numeric(12,2);
  v_quantity integer;
  v_gross numeric(12,2);
  v_net numeric(12,2);
  v_profit numeric(12,2);
  v_order_no text:=nullif(trim(coalesce(p_order_no,'')),'');
  v_note text:=nullif(trim(coalesce(p_note,'')),'');
  v_payload jsonb;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_existing_result jsonb;
  v_previous jsonb;
  v_snapshot jsonb;
  v_result jsonb;
  v_revision integer;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if trim(coalesce(p_activity_id,''))='' or length(p_activity_id)>200 then raise exception 'Invalid activity id'; end if;
  if trim(coalesce(p_operation_id,''))='' or length(p_operation_id)>160 then raise exception 'Invalid settlement operation id'; end if;
  if p_actual_platform_fee is null or p_actual_platform_fee<0 or p_actual_platform_fee>1000000 then raise exception 'Actual platform fee is outside the allowed range'; end if;
  if p_settled_at is null or p_settled_at<'2000-01-01'::timestamptz or p_settled_at>now()+interval '1 day' then raise exception 'Settlement time is invalid'; end if;
  if length(coalesce(v_order_no,''))>100 or length(coalesce(v_note,''))>500 then raise exception 'Settlement text is too long'; end if;
  v_fee:=round(p_actual_platform_fee,2);
  v_payload:=jsonb_build_object('activityId',p_activity_id,'actualPlatformFee',v_fee,'settledAt',p_settled_at,'orderNo',v_order_no,'note',v_note);
  v_fingerprint:=encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('outbound-settlement:'||p_user_id::text||':'||p_operation_id,0));
  select payload_fingerprint,result into v_existing_fingerprint,v_existing_result from public.outbound_settlement_audit where user_id=p_user_id and operation_id=p_operation_id;
  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'Settlement operation id was already used for different data'; end if;
    return v_existing_result||jsonb_build_object('replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('outbound-settlement-activity:'||p_user_id::text||':'||p_activity_id,0));
  select * into v_activity from public.activities where id=p_activity_id and user_id=p_user_id and type='outbound' for update;
  if not found then raise exception 'Outbound activity not found'; end if;
  if p_settled_at<v_activity.created_at then raise exception 'Settlement time cannot be earlier than outbound time'; end if;
  if v_activity.count is null then v_quantity:=1; elsif v_activity.count<=0 or v_activity.count<>trunc(v_activity.count) then raise exception 'Outbound activity quantity is invalid'; else v_quantity:=v_activity.count::integer; end if;
  v_gross:=round(coalesce(v_activity.price,0)*v_quantity,2);
  v_net:=round(v_gross-v_fee,2);
  v_profit:=case when v_activity.cost is null then null else round(v_net-v_activity.cost*v_quantity,2) end;
  v_revision:=coalesce(v_activity.settlement_revision,0)+1;
  v_previous:=case when v_activity.settlement_revision>0 then jsonb_build_object(
    'actualPlatformFee',v_activity.actual_platform_fee,'actualNetProceeds',v_activity.actual_net_proceeds,'actualNetProfit',v_activity.actual_net_profit,
    'settledAt',v_activity.settled_at,'orderNo',v_activity.settlement_order_no,'note',v_activity.settlement_note,'revision',v_activity.settlement_revision
  ) else null end;
  v_snapshot:=jsonb_build_object('schemaVersion','outbound-settlement@1','activityId',p_activity_id,'grossAmount',v_gross,'quantity',v_quantity,
    'frozenUnitCost',v_activity.cost,'actualPlatformFee',v_fee,'actualNetProceeds',v_net,'actualNetProfit',v_profit,
    'settledAt',p_settled_at,'orderNo',v_order_no,'note',v_note,'revision',v_revision);
  perform set_config('app.allow_outbound_settlement','on',true);
  update public.activities set actual_platform_fee=v_fee,actual_net_proceeds=v_net,actual_net_profit=v_profit,settled_at=p_settled_at,
    settlement_order_no=v_order_no,settlement_note=v_note,settlement_revision=v_revision where id=p_activity_id and user_id=p_user_id;
  perform set_config('app.allow_outbound_settlement','off',true);
  v_result:=jsonb_build_object('activity_id',p_activity_id,'actual_platform_fee',v_fee,'actual_net_proceeds',v_net,'actual_net_profit',v_profit,
    'settled_at',p_settled_at,'settlement_revision',v_revision,'replayed',false);
  insert into public.outbound_settlement_audit(user_id,activity_id,operation_id,payload_fingerprint,revision,previous_snapshot,settlement_snapshot,result)
  values(p_user_id,p_activity_id,p_operation_id,v_fingerprint,v_revision,v_previous,v_snapshot,v_result);
  return v_result;
end;
$$;

revoke all on function public.settle_outbound_activity(uuid,text,text,numeric,timestamptz,text,text) from public,anon;
grant execute on function public.settle_outbound_activity(uuid,text,text,numeric,timestamptz,text,text) to authenticated;

commit;
