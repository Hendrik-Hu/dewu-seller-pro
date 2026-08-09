begin;

do $$
declare
  v_user uuid;
  v_other_user uuid := extensions.gen_random_uuid();
  v_first jsonb;
  v_second jsonb;
  v_current jsonb;
  v_failed boolean;
  v_old_name text := 'Warehouse smoke primary';
  v_new_name text := 'Warehouse smoke renamed';
  v_product_id text := 'warehouse-smoke-product-' || txid_current()::text;
  v_activity_id text := 'warehouse-smoke-activity-' || txid_current()::text;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'Smoke test requires one auth user'; end if;

  delete from public.products where user_id = v_user;
  delete from public.warehouses where user_id = v_user;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_user,'role','authenticated')::text, true);

  v_first := public.create_warehouse(v_old_name);
  if (v_first->>'is_default')::boolean is not true then raise exception 'First warehouse was not default'; end if;
  v_second := public.create_warehouse('Warehouse smoke second');
  if (v_second->>'is_default')::boolean is true then raise exception 'Second warehouse became default'; end if;

  v_failed := false;
  begin perform public.create_warehouse(' warehouse smoke primary ');
  exception when others then v_failed := sqlerrm like '%已存在%'; end;
  if not v_failed then raise exception 'Normalized duplicate warehouse was accepted'; end if;

  perform public.create_warehouse('Warehouse smoke 3');
  perform public.create_warehouse('Warehouse smoke 4');
  perform public.create_warehouse('Warehouse smoke 5');
  perform public.create_warehouse('Warehouse smoke 6');
  v_failed := false;
  begin perform public.create_warehouse('Warehouse smoke 7');
  exception when others then v_failed := sqlerrm like '%6%'; end;
  if not v_failed then raise exception 'Seventh warehouse was accepted'; end if;

  v_current := public.set_default_warehouse((v_second->>'id')::uuid);
  if (select count(*) from public.warehouses where user_id=v_user and is_default) <> 1
    or (v_current->>'is_default')::boolean is not true then
    raise exception 'Default warehouse switch was not unique';
  end if;

  insert into public.products(id,name,brand,size,sku,price,stock,image_url,status,location,created_at,warehouse,user_id)
  values(v_product_id,'Warehouse smoke','Test','42','WH-SMOKE',1,1,'','instock','',now(),v_old_name,v_user);
  insert into public.activities(id,type,product_name,time,sku,price,image_url,created_at,warehouse,cost,count,user_id,size)
  values(v_activity_id,'inbound','Warehouse smoke','','WH-SMOKE',1,'',now(),v_old_name,1,1,v_user,'42');

  perform public.rename_warehouse((v_first->>'id')::uuid, v_new_name);
  if not exists(select 1 from public.products where id=v_product_id and warehouse=v_new_name) then
    raise exception 'Product warehouse was not renamed';
  end if;
  if not exists(select 1 from public.activities where id=v_activity_id and warehouse=v_old_name) then
    raise exception 'Historical activity warehouse was rewritten';
  end if;

  v_failed := false;
  begin perform public.delete_warehouse((v_first->>'id')::uuid);
  exception when others then v_failed := sqlerrm like '%仍有库存%'; end;
  if not v_failed then raise exception 'Warehouse with inventory was deleted'; end if;

  update public.products set stock=0 where id=v_product_id;
  perform public.delete_warehouse((v_second->>'id')::uuid);
  if (select count(*) from public.warehouses where user_id=v_user and is_default) <> 1 then
    raise exception 'Deleting the default warehouse did not select one replacement';
  end if;

  perform public.delete_warehouse((v_first->>'id')::uuid);
  if public.count_orphan_warehouse_products() <> 0
    or exists (select 1 from public.list_orphan_warehouse_products()) then
    raise exception 'Deleting a zero-stock warehouse created a health warning';
  end if;

  v_failed := false;
  begin
    insert into public.products(id,name,brand,size,sku,price,stock,image_url,status,location,created_at,warehouse,user_id)
    values(v_product_id||'-invalid','Invalid','Test','42','WH-INVALID',1,1,'','instock','',now(),'Missing warehouse',v_user);
  exception when others then v_failed := sqlerrm like '%仓库不存在%'; end;
  if not v_failed then raise exception 'Product with missing warehouse was accepted'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_other_user,'role','authenticated')::text, true);
  v_failed := false;
  begin perform public.set_default_warehouse((v_first->>'id')::uuid);
  exception when others then v_failed := sqlerrm like '%无权访问%'; end;
  if not v_failed then raise exception 'Different user changed a warehouse'; end if;
end;
$$;

rollback;
