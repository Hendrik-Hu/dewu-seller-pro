begin;

create or replace function public.sync_sales_order_after_settlement()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_order public.sales_orders%rowtype;
  v_order_id uuid;
  v_operation_id text;
  v_result jsonb;
begin
  select sales_order_id into v_order_id from public.activities
  where id=new.activity_id and user_id=new.user_id and type='outbound';
  if v_order_id is null then return new; end if;

  select * into v_order from public.sales_orders
  where id=v_order_id and user_id=new.user_id for update;
  if not found then raise exception 'Linked sales order not found'; end if;
  if v_order.status not in ('authenticated','settled') then
    raise exception 'Sales order must pass authentication before settlement';
  end if;
  if v_order.status='settled' then return new; end if;

  update public.sales_orders set status='settled',settled_at=(new.settlement_snapshot->>'settledAt')::timestamptz,
    updated_at=now(),version=version+1
  where id=v_order.id and user_id=new.user_id;
  v_operation_id:='sales-order-settle:'||new.id::text;
  v_result:=jsonb_build_object('orderId',v_order.id,'status','settled','version',v_order.version+1,
    'action','settle','outboundActivityId',new.activity_id,'inventoryRestored',v_order.inventory_restored,'replayed',false);
  insert into public.sales_order_events(user_id,order_id,operation_id,payload_fingerprint,action,from_status,to_status,details,result,created_at)
  values(new.user_id,v_order.id,v_operation_id,new.payload_fingerprint,'settle','authenticated','settled',
    jsonb_build_object('settlementAuditId',new.id,'revision',new.revision),v_result,new.created_at);
  return new;
end;
$$;

drop trigger if exists outbound_settlement_sync_sales_order on public.outbound_settlement_audit;
create trigger outbound_settlement_sync_sales_order
before insert on public.outbound_settlement_audit
for each row execute function public.sync_sales_order_after_settlement();

revoke all on function public.sync_sales_order_after_settlement() from public,anon,authenticated;

commit;
