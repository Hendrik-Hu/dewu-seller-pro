begin;

do $$
declare
  v_user uuid;
  v_suffix text := txid_current()::text;
  v_product_id text := 'fee-smoke-product-' || txid_current()::text;
  v_zero_product_id text := 'fee-smoke-zero-' || txid_current()::text;
  v_operation_id text := 'fee-smoke-operation-' || txid_current()::text;
  v_scheme_id uuid;
  v_scheme_updated_at timestamptz;
  v_first jsonb;
  v_replay jsonb;
  v_activity public.activities%rowtype;
  v_failed boolean;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'Smoke test requires one auth user'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_user,'role','authenticated')::text, true);

  if not exists (
    select 1 from pg_indexes where schemaname='public' and tablename='fee_schemes'
      and indexname='fee_schemes_one_default_per_user_idx' and indexdef ilike '%where is_default%'
  ) then raise exception 'Missing partial unique default scheme index'; end if;

  insert into public.fee_schemes (
    user_id,name,sale_mode,category,percent_rate,percent_min,percent_max,percentage_unit,
    fixed_fee,fixed_fee_unit,shipping_fee,shipping_fee_unit,other_fee,other_fee_unit,effective_from,is_default
  ) values (
    v_user,'Fee smoke','normal','shoes',5,3,20,'transaction',2,'transaction',8,'transaction',1,'transaction',now(),true
  ) returning id,updated_at into v_scheme_id,v_scheme_updated_at;

  insert into public.products (id,name,brand,size,sku,price,stock,image_url,status,location,created_at,warehouse,user_id,deleted_at,source)
  values (v_product_id,'Fee smoke product','Codex','42','FEE-'||v_suffix,1,5,'','instock','',now(),'Smoke warehouse',v_user,null,'smoke');

  v_first := public.outbound_product_with_fees(v_product_id,v_user,1.005,3,'得物',v_operation_id,v_scheme_id,v_scheme_updated_at,null);
  v_replay := public.outbound_product_with_fees(v_product_id,v_user,1.005,3,'得物',v_operation_id,v_scheme_id,v_scheme_updated_at,null);
  if (v_first->>'replayed')::boolean then raise exception 'First execution marked as replay'; end if;
  if not (v_replay->>'replayed')::boolean then raise exception 'Replay was not marked'; end if;
  if (v_first->>'stock')::integer <> 2 then raise exception 'Unexpected stock result'; end if;
  if (v_first->>'gross_amount')::numeric <> 3.03 then raise exception 'Sale price was not normalized to cents'; end if;
  if (v_first->>'estimated_platform_fee')::numeric <> 14 then raise exception 'Unexpected fee total'; end if;

  select * into v_activity from public.activities where id=v_first->>'activity_id' and user_id=v_user;
  if v_activity.price <> 1.01 or v_activity.count <> 3 or v_activity.estimated_platform_fee <> 14 then
    raise exception 'Activity snapshot differs from normalized execution';
  end if;
  if (select count(*) from public.activities where user_id=v_user and sku='FEE-'||v_suffix) <> 1 then raise exception 'Replay duplicated activity'; end if;

  v_failed := false;
  begin
    perform public.outbound_product_with_fees(v_product_id,v_user,2,1,'得物',v_operation_id,v_scheme_id,v_scheme_updated_at,null);
  exception when others then v_failed := sqlerrm like '%different data%'; end;
  if not v_failed then raise exception 'Changed idempotency payload was accepted'; end if;

  insert into public.products (id,name,brand,size,sku,price,stock,image_url,status,location,created_at,warehouse,user_id,deleted_at,source)
  values (v_zero_product_id,'Zero sale smoke','Codex','43','FEE-ZERO-'||v_suffix,10,1,'','instock','',now(),'Smoke warehouse',v_user,null,'smoke');
  v_first := public.outbound_product_with_fees(v_zero_product_id,v_user,0,1,'线下',v_operation_id||'-zero',null,null,0);
  if (v_first->>'estimated_platform_fee')::numeric <> 0 or (v_first->>'estimated_net_profit')::numeric <> -10 then
    raise exception 'Explicit zero sale or manual fee was not preserved';
  end if;

  v_failed := false;
  begin perform public.outbound_product_with_fees(v_product_id,v_user,1,1001,'得物',v_operation_id||'-qty',null,null,null);
  exception when others then v_failed := sqlerrm like '%between 1 and 1000%'; end;
  if not v_failed then raise exception 'Oversized quantity was accepted'; end if;

  v_failed := false;
  begin perform public.outbound_product_with_fees(v_product_id,v_user,1000000.01,1,'得物',v_operation_id||'-money',null,null,null);
  exception when others then v_failed := sqlerrm like '%outside the allowed range%'; end;
  if not v_failed then raise exception 'Oversized sale price was accepted'; end if;

  v_failed := false;
  begin update public.activities set estimated_platform_fee=0 where id=v_activity.id;
  exception when others then v_failed := sqlerrm like '%immutable%'; end;
  if not v_failed then raise exception 'Historical fee snapshot was mutable'; end if;
end;
$$;

rollback;
