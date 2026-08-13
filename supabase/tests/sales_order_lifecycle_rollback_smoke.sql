begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_instance uuid := '00000000-0000-0000-0000-000000000000';
  v_product_id text := 'sales-order-smoke-' || txid_current()::text;
  v_cancel_product_id text := 'sales-order-cancel-' || txid_current()::text;
  v_create jsonb;
  v_replay jsonb;
  v_transition jsonb;
  v_order_id uuid;
  v_failed boolean;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
  values(v_user,v_instance,'authenticated','authenticated','sales-order-smoke-'||v_user||'@example.invalid','',now(),now(),now());
  insert into public.warehouses(user_id,name,is_default) values(v_user,'Sales order smoke',true);
  insert into public.products(id,name,brand,size,sku,price,stock,image_url,status,location,created_at,warehouse,user_id,source)
  values(v_product_id,'Sales order smoke','Test','42','ORDER-SMOKE',100,3,'','instock','A1',now(),'Sales order smoke',v_user,'smoke');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);

  v_create := public.create_sales_order(v_user,v_product_id,2,150,'得物','sales-order-create-smoke',null,null,10,'ORDER-001','回滚烟测');
  v_order_id := (v_create->>'orderId')::uuid;
  if (select stock from public.products where id=v_product_id) <> 1 then raise exception 'Order creation did not reserve inventory'; end if;
  if (select count(*) from public.activities where user_id=v_user) <> 0 then raise exception 'Order creation wrote outbound activity before shipment'; end if;
  if (select status from public.sales_orders where id=v_order_id) <> 'pending_shipment' then raise exception 'Order did not enter pending shipment'; end if;
  if (select estimated_platform_fee from public.sales_orders where id=v_order_id) <> 10 then raise exception 'Frozen manual fee was not preserved'; end if;

  v_replay := public.create_sales_order(v_user,v_product_id,2,150,'得物','sales-order-create-smoke',null,null,10,'ORDER-001','回滚烟测');
  if not (v_replay->>'replayed')::boolean or (select count(*) from public.sales_orders where user_id=v_user) <> 1
    or (select stock from public.products where id=v_product_id) <> 1 then raise exception 'Create replay was not idempotent'; end if;
  v_failed := false;
  begin perform public.create_sales_order(v_user,v_product_id,1,150,'得物','sales-order-create-smoke',null,null,10,'ORDER-001','回滚烟测');
  exception when others then v_failed := sqlerrm like '%different data%'; end;
  if not v_failed then raise exception 'Changed create payload reused operation id'; end if;

  v_failed := false;
  begin update public.products set deleted_at=now() where id=v_product_id;
  exception when others then v_failed := sqlerrm like '%active sales order%'; end;
  if not v_failed then raise exception 'Reserved product could be moved to recycle bin'; end if;

  v_transition := public.transition_sales_order(v_user,v_order_id,'ship','pending_shipment',1,'sales-order-ship-smoke');
  if v_transition->>'status' <> 'shipped' or (select stock from public.products where id=v_product_id) <> 1 then raise exception 'Shipment deducted inventory twice'; end if;
  if (select count(*) from public.activities where user_id=v_user and type='outbound' and sales_order_id=v_order_id) <> 1 then raise exception 'Shipment did not write exactly one linked outbound activity'; end if;
  v_replay := public.transition_sales_order(v_user,v_order_id,'ship','pending_shipment',1,'sales-order-ship-smoke');
  if not (v_replay->>'replayed')::boolean or (select count(*) from public.activities where sales_order_id=v_order_id) <> 1 then raise exception 'Shipment replay duplicated activity'; end if;

  perform public.transition_sales_order(v_user,v_order_id,'start_authentication','shipped',2,'sales-order-auth-start-smoke');
  perform public.transition_sales_order(v_user,v_order_id,'fail_authentication','authenticating',3,'sales-order-auth-fail-smoke');
  if (select stock from public.products where id=v_product_id) <> 1 then raise exception 'Authentication failure restored inventory before physical return'; end if;
  perform public.transition_sales_order(v_user,v_order_id,'start_return','auth_failed',4,'sales-order-return-start-smoke');
  v_transition := public.transition_sales_order(v_user,v_order_id,'confirm_return','returning',5,'sales-order-return-confirm-smoke');
  if v_transition->>'status' <> 'returned' or (select stock from public.products where id=v_product_id) <> 3 then raise exception 'Confirmed return did not restore reserved inventory'; end if;
  if (select count(*) from public.activities where user_id=v_user and type='restore' and sku='ORDER-SMOKE') <> 1 then raise exception 'Return did not write one restore activity'; end if;
  v_replay := public.transition_sales_order(v_user,v_order_id,'confirm_return','returning',5,'sales-order-return-confirm-smoke');
  if not (v_replay->>'replayed')::boolean or (select stock from public.products where id=v_product_id) <> 3 then raise exception 'Return replay restored inventory twice'; end if;

  insert into public.products(id,name,brand,size,sku,price,stock,image_url,status,location,created_at,warehouse,user_id,source)
  values(v_cancel_product_id,'Cancel smoke','Test','43','ORDER-CANCEL',80,1,'','instock','A2',now(),'Sales order smoke',v_user,'smoke');
  v_create := public.create_sales_order(v_user,v_cancel_product_id,1,120,'线下','sales-order-cancel-create',null,null,0,null,null);
  v_order_id := (v_create->>'orderId')::uuid;
  perform public.transition_sales_order(v_user,v_order_id,'cancel','pending_shipment',1,'sales-order-cancel-action');
  if (select stock from public.products where id=v_cancel_product_id) <> 1
    or (select status from public.sales_orders where id=v_order_id) <> 'canceled' then raise exception 'Canceled order did not restore inventory'; end if;

  v_failed := false;
  begin perform public.transition_sales_order(v_user,v_order_id,'ship','pending_shipment',1,'sales-order-stale-action');
  exception when others then v_failed := sqlerrm like '%changed%'; end;
  if not v_failed then raise exception 'Stale expected status/version was accepted'; end if;
end;
$$;

rollback;
