begin;

do $$
declare
  v_user uuid;
  v_activity_id text:='settlement-smoke-'||txid_current()::text;
  v_operation_id text:='settlement-op-'||txid_current()::text;
  v_created_at timestamptz:=now()-interval '1 hour';
  v_first jsonb;
  v_replay jsonb;
  v_second jsonb;
  v_failed boolean;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'Smoke test requires one auth user'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);

  insert into public.activities(id,type,product_name,time,sku,size,price,cost,image_url,created_at,warehouse,count,user_id)
  values(v_activity_id,'outbound','Settlement smoke','','SETTLE-SMOKE','42',100,60,'',v_created_at,'Smoke warehouse',2,v_user);

  v_first:=public.settle_outbound_activity(v_user,v_activity_id,v_operation_id,250,now(),'ORDER-1','处罚核对');
  v_replay:=public.settle_outbound_activity(v_user,v_activity_id,v_operation_id,250,now(),'ORDER-1','处罚核对');
  if (v_first->>'actual_net_proceeds')::numeric<>-50 or (v_first->>'actual_net_profit')::numeric<>-170 then raise exception 'Negative take-home calculation failed'; end if;
  if (v_first->>'settlement_revision')::integer<>1 or (v_replay->>'replayed')::boolean is not true then raise exception 'Settlement idempotency failed'; end if;
  if (select count(*) from public.outbound_settlement_audit where user_id=v_user and activity_id=v_activity_id)<>1 then raise exception 'Replay duplicated audit'; end if;

  v_second:=public.settle_outbound_activity(v_user,v_activity_id,v_operation_id||'-2',20,now(),'ORDER-1','结算更正');
  if (v_second->>'settlement_revision')::integer<>2 then raise exception 'Correction revision failed'; end if;
  if not exists(select 1 from public.outbound_settlement_audit where user_id=v_user and activity_id=v_activity_id and revision=2 and previous_snapshot->>'actualPlatformFee'='250.00') then raise exception 'Correction history is incomplete'; end if;

  v_failed:=false;
  begin perform public.settle_outbound_activity(v_user,v_activity_id,v_operation_id,20,now(),'ORDER-1','changed');
  exception when others then v_failed:=sqlerrm like '%different data%'; end;
  if not v_failed then raise exception 'Changed idempotency payload was accepted'; end if;

  v_failed:=false;
  begin perform public.settle_outbound_activity(v_user,v_activity_id,v_operation_id||'-early',0,v_created_at-interval '1 minute',null,null);
  exception when others then v_failed:=sqlerrm like '%earlier than outbound%'; end;
  if not v_failed then raise exception 'Settlement before outbound was accepted'; end if;

  v_failed:=false;
  begin update public.activities set actual_platform_fee=0 where id=v_activity_id;
  exception when others then v_failed:=sqlerrm like '%settlement RPC%'; end;
  if not v_failed then raise exception 'Direct settlement update was accepted'; end if;

  v_failed:=false;
  begin
    insert into public.activities(id,type,product_name,time,sku,price,image_url,created_at,count,user_id,actual_platform_fee,settlement_revision)
    values(v_activity_id||'-forged','outbound','Forged','','FORGED',1,'',now(),1,v_user,0,1);
  exception when others then v_failed:=sqlerrm like '%without an audit%'; end;
  if not v_failed then raise exception 'Forged settlement insert was accepted'; end if;
end;
$$;

rollback;
