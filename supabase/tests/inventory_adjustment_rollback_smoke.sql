begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_instance uuid := '00000000-0000-0000-0000-000000000000';
  v_warehouse_id uuid := gen_random_uuid();
  v_product_id text := 'adjust-smoke-product-' || txid_current()::text;
  v_pending_id text := 'adjust-smoke-pending-' || txid_current()::text;
  v_result jsonb;
  v_replay jsonb;
  v_failed boolean;
  v_rows jsonb;
  v_package jsonb;
  v_preview jsonb;
  v_execute jsonb;
  v_restore_sku text := 'RESTORE-ADJUST-' || txid_current()::text;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
  values(v_user,v_instance,'authenticated','authenticated','adjust-smoke-'||v_user||'@example.invalid','',now(),now(),now());
  insert into public.warehouses(id,user_id,name,is_default) values(v_warehouse_id,v_user,'Adjustment smoke',true);
  insert into public.products(id,name,brand,size,sku,price,stock,image_url,status,location,created_at,warehouse,user_id,source)
  values(v_product_id,'Adjustment smoke','Test','42','ADJUST-SMOKE',100,10,'','instock','A1',now(),'Adjustment smoke',v_user,'smoke');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);

  v_result := public.adjust_product_inventory(v_product_id,'adjust-first-operation',10,100,'instock',9,101,'实物盘点少一双');
  v_replay := public.adjust_product_inventory(v_product_id,'adjust-first-operation',10,100,'instock',9,101,'实物盘点少一双');
  if (v_result->>'replayed')::boolean or not (v_replay->>'replayed')::boolean then raise exception 'Adjustment replay flags are invalid'; end if;
  if (select count(*) from public.inventory_adjustment_audit where user_id=v_user) <> 1 then raise exception 'Adjustment replay duplicated audit'; end if;

  v_failed := false;
  begin perform public.adjust_product_inventory(v_product_id,'adjust-first-operation',10,100,'instock',8,101,'更换了同操作请求');
  exception when others then v_failed := sqlerrm like '%绑定其他内容%'; end;
  if not v_failed then raise exception 'Changed adjustment payload was accepted'; end if;

  perform public.adjust_product_inventory(v_product_id,'adjust-concurrent-b',9,101,'instock',8,101,'设备B先完成盘点');
  v_failed := false;
  begin perform public.adjust_product_inventory(v_product_id,'adjust-concurrent-a',9,101,'instock',7,101,'设备A使用旧快照');
  exception when others then v_failed := sqlerrm like '%已发生变化%'; end;
  if not v_failed or (select stock from public.products where id=v_product_id) <> 8 then raise exception 'Stale adjustment overwrote current stock'; end if;

  update public.products set stock=0,status='sold' where id=v_product_id;
  v_result := public.adjust_product_inventory(v_product_id,'adjust-reopen-sold',0,101,'sold',1,101,'盘点发现一双库存');
  if v_result->>'newStatus' <> 'instock' then raise exception 'Sold product did not reopen after positive stock adjustment'; end if;

  v_failed := false;
  begin perform public.soft_delete_products(array[v_product_id,v_product_id]);
  exception when others then v_failed := sqlerrm like '%无效%'; end;
  if not v_failed then raise exception 'Duplicate soft-delete ids were accepted'; end if;
  v_failed := false;
  begin perform public.soft_delete_products(array['missing-product']);
  exception when others then v_failed := sqlerrm like '%不存在%'; end;
  if not v_failed then raise exception 'Missing soft-delete id was reported as success'; end if;

  insert into public.products(id,name,brand,size,sku,price,stock,image_url,status,location,created_at,warehouse,user_id,source)
  values(v_pending_id,'Transit smoke','Test','43','TRANSIT-SMOKE',100,1,'','shipping','A2',now(),'Adjustment smoke',v_user,'smoke');
  v_result := public.adjust_product_inventory(
    v_pending_id,'transit-arrival-operation',1,100,'shipping',1,100,
    '运输中商品确认到仓','instock'
  );
  v_replay := public.adjust_product_inventory(
    v_pending_id,'transit-arrival-operation',1,100,'shipping',1,100,
    '运输中商品确认到仓','instock'
  );
  if v_result->>'newStatus' <> 'instock' or not (v_replay->>'replayed')::boolean
    or (select stock from public.products where id=v_pending_id) <> 1 then
    raise exception 'Transit arrival did not preserve stock or replay idempotently';
  end if;
  v_failed := false;
  begin perform public.complete_pending_products(array[v_pending_id]);
  exception when others then v_failed := sqlerrm like '%旧功能已停用%'; end;
  if not v_failed then raise exception 'Ledgerless pending completion remained callable'; end if;
  v_result := public.outbound_product_with_fees(
    v_pending_id,v_user,150,1,'线下','transit-outbound-operation',null,null,0
  );
  if (select status from public.products where id=v_pending_id) <> 'sold'
    or (select stock from public.products where id=v_pending_id) <> 0
    or (select count(*) from public.activities where user_id=v_user and sku='TRANSIT-SMOKE' and type='outbound') <> 1 then
    raise exception 'Transit product sale did not use the outbound ledger path';
  end if;

  v_rows := jsonb_build_array(jsonb_build_object(
    'id','batch-smoke-product','sku','BATCH-SMOKE','size','44','warehouse','Adjustment smoke',
    'name','Batch smoke','brand','Test','image_url','','location','A3','source','smoke',
    'quantity',1,'cost',88,'status','instock'
  ));
  perform public.batch_inbound_products(v_rows,v_user,'batch-smoke-operation');
  perform public.batch_inbound_products(v_rows,v_user,'batch-smoke-operation','手动批量入库');
  if (select count(*) from public.products where user_id=v_user and sku='BATCH-SMOKE') <> 1 then raise exception 'Batch overload replay duplicated inventory'; end if;
  v_failed := false;
  begin perform public.batch_inbound_products(v_rows,v_user,repeat('x',121));
  exception when others then v_failed := sqlerrm like '%batch id%'; end;
  if not v_failed then raise exception 'Oversized batch id was accepted'; end if;
  v_failed := false;
  begin perform public.batch_inbound_products(jsonb_set(v_rows,'{0,sku}',to_jsonb(repeat('S',121))),v_user,'batch-long-sku');
  exception when others then v_failed := sqlerrm like '%fields or lengths%'; end;
  if not v_failed then raise exception 'Oversized inbound SKU was accepted'; end if;

  v_rows := jsonb_build_array(jsonb_build_object(
    'id','transit-batch-product','sku','TRANSIT-BATCH','size','45','warehouse','Adjustment smoke',
    'name','Transit batch','brand','Test','image_url','','location','A4','source','smoke',
    'quantity',2,'cost',66,'status','shipping'
  ));
  perform public.batch_inbound_products(v_rows,v_user,'transit-batch-operation');
  if not exists(select 1 from public.products where user_id=v_user and sku='TRANSIT-BATCH' and status='shipping' and stock=2) then
    raise exception 'Purchase transit inbound was not persisted as shipping';
  end if;
  v_failed := false;
  begin perform public.batch_inbound_products(v_rows,v_user,'transit-batch-operation-2');
  exception when others then v_failed := sqlerrm like '%不能与现有%'; end;
  if not v_failed then raise exception 'Transit inventory merged into an existing variant'; end if;

  v_package := jsonb_build_object(
    'schemaVersion','dewu-seller-pro/ledger-backup@4','exportedAt',now()::text,'scope','full-ledger',
    'counts',jsonb_build_object('products',1,'activeProducts',1,'recycledProducts',0,'activities',0,'warehouses',1,'repairs',0,'feeSchemes',0,'settlements',0,'inventoryAdjustments',1),
    'media',jsonb_build_object('included',false,'note','smoke'),
    'data',jsonb_build_object(
      'warehouses',jsonb_build_array(jsonb_build_object('sourceId','restore-adjust-wh','name','Restore adjustment smoke','isDefault',false,'createdAt',now()::text)),
      'products',jsonb_build_array(jsonb_build_object('sourceId','restore-adjust-product','name','Restore adjustment product','brand','Test','size','45','sku',v_restore_sku,'cost',50,'stock',5,'status','instock','location','R1','warehouse','Restore adjustment smoke','source','backup','createdAt',now()::text,'deletedAt',null)),
      'activities','[]'::jsonb,'repairs','[]'::jsonb,'feeSchemes','[]'::jsonb,'settlements','[]'::jsonb,
      'inventoryAdjustments',jsonb_build_array(jsonb_build_object('sourceId','11111111-1111-1111-1111-111111111111','operationId','source-adjust-operation','productSourceId','restore-adjust-product','sku',v_restore_sku,'size','45','warehouse','Restore adjustment smoke','oldStock',6,'newStock',5,'oldCost',50,'newCost',50,'oldStatus','instock','newStatus','instock','reason','备份历史盘点记录','createdAt',now()::text))
    ),
    'integrity',jsonb_build_object('algorithm','SHA-256','value',repeat('a',64))
  );
  v_preview := public.restore_ledger_backup(v_user,'preview-adjust-restore',v_package,true);
  v_execute := public.restore_ledger_backup(v_user,'execute-adjust-restore',v_package,false);
  if (v_preview->>'added')::integer <> (v_execute->>'added')::integer
    or (v_preview->>'conflicts')::integer <> (v_execute->>'conflicts')::integer then
    raise exception 'Adjustment restore preview differs from execution';
  end if;
  if not exists(select 1 from public.products where user_id=v_user and sku=v_restore_sku and stock=5) then raise exception 'Adjustment history replayed a stock change'; end if;
  if (select count(*) from public.inventory_adjustment_audit where user_id=v_user and sku=v_restore_sku) <> 1 then raise exception 'Adjustment history was not restored exactly once'; end if;
  perform public.restore_ledger_backup(v_user,'execute-adjust-restore-new-op',v_package,false);
  if (select count(*) from public.inventory_adjustment_audit where user_id=v_user and sku=v_restore_sku) <> 1 then raise exception 'Same backup duplicated adjustment history'; end if;

  if has_table_privilege('authenticated','public.products','INSERT')
    or has_table_privilege('authenticated','public.products','UPDATE')
    or has_table_privilege('authenticated','public.activities','INSERT')
    or has_table_privilege('authenticated','public.activities','UPDATE') then
    raise exception 'Direct authenticated inventory writes remain granted';
  end if;
end;
$$;

rollback;
