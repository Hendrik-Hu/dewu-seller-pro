begin;

do $$
declare
  v_user uuid:=gen_random_uuid();
  v_instance uuid:='00000000-0000-0000-0000-000000000000';
  v_order_source uuid:=gen_random_uuid();
  v_event_source uuid:=gen_random_uuid();
  v_package jsonb;
  v_v4 jsonb;
  v_preview jsonb;
  v_execute jsonb;
  v_replay jsonb;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
  values(v_user,v_instance,'authenticated','authenticated','sales-order-backup-'||v_user||'@example.invalid','',now(),now(),now());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  v_package:=jsonb_build_object(
    'schemaVersion','dewu-seller-pro/ledger-backup@5','exportedAt',now(),'scope','full-ledger',
    'counts',jsonb_build_object('products',1,'activeProducts',1,'recycledProducts',0,'activities',0,'warehouses',1,'repairs',0,'feeSchemes',0,'settlements',0,'inventoryAdjustments',0,'salesOrders',1,'salesOrderEvents',1),
    'media',jsonb_build_object('included',false,'note','smoke'),'integrity',jsonb_build_object('algorithm','SHA-256','value',repeat('a',64)),
    'data',jsonb_build_object(
      'warehouses',jsonb_build_array(jsonb_build_object('sourceId',gen_random_uuid()::text,'name','Backup smoke','isDefault',true,'createdAt',now())),
      'products',jsonb_build_array(jsonb_build_object('sourceId','backup-product','name','Backup product','brand','Test','size','42','sku','BACKUP-ORDER','cost',100,'stock',2,'status','instock','location','','warehouse','Backup smoke','source','smoke','createdAt',now(),'deletedAt',null)),
      'activities','[]'::jsonb,'repairs','[]'::jsonb,'feeSchemes','[]'::jsonb,'settlements','[]'::jsonb,'inventoryAdjustments','[]'::jsonb,
      'salesOrders',jsonb_build_array(jsonb_build_object(
        'sourceId',v_order_source::text,'productSourceId','backup-product','status','pending_shipment','productName','Backup product','brand','Test','sku','BACKUP-ORDER','size','42','warehouse','Backup smoke','quantity',1,'unitSalePrice',150,'frozenUnitCost',100,'platform','得物','externalOrderNo','','note','','feeSnapshot',jsonb_build_object('schemaVersion','fee-snapshot@1','status','unknown'),'estimatedPlatformFee',null,'estimatedNetProceeds',null,'estimatedNetProfit',null,'outboundActivitySourceId','','inventoryRestored',false,'version',1,'createdAt',now(),'updatedAt',now(),'shippedAt',null,'authenticationStartedAt',null,'authenticatedAt',null,'settledAt',null,'canceledAt',null,'returnStartedAt',null,'returnedAt',null,'refundedAt',null
      )),
      'salesOrderEvents',jsonb_build_array(jsonb_build_object(
        'sourceId',v_event_source::text,'orderSourceId',v_order_source::text,'operationId','original-create-operation','payloadFingerprint',repeat('b',64),'action','create','fromStatus',null,'toStatus','pending_shipment','details',jsonb_build_object(),'result',jsonb_build_object('status','pending_shipment'),'createdAt',now()
      ))
    )
  );
  v_preview:=public.restore_ledger_backup(v_user,'sales-order-backup-preview',v_package,true);
  if (v_preview->>'dryRun')::boolean is not true or (select count(*) from public.sales_orders where user_id=v_user)<>0 then raise exception 'V5 preview did not roll back'; end if;
  v_execute:=public.restore_ledger_backup(v_user,'sales-order-backup-execute',v_package,false);
  if (v_preview->>'added') is distinct from (v_execute->>'added') or (v_preview->>'conflicts') is distinct from (v_execute->>'conflicts') then raise exception 'V5 preview and execute counts differ'; end if;
  if (select count(*) from public.sales_orders where user_id=v_user)<>1 or (select count(*) from public.sales_order_events where user_id=v_user)<>1 then raise exception 'V5 sales order history was not restored'; end if;
  if (select stock from public.products where user_id=v_user and sku='BACKUP-ORDER')<>2 then raise exception 'Restoring order history replayed inventory reservation'; end if;
  v_replay:=public.restore_ledger_backup(v_user,'sales-order-backup-execute',v_package,false);
  if (select count(*) from public.sales_orders where user_id=v_user)<>1 or v_replay->>'payloadFingerprint' is null then raise exception 'V5 replay duplicated order history'; end if;

  v_v4:=jsonb_set(v_package,'{schemaVersion}',to_jsonb('dewu-seller-pro/ledger-backup@4'::text));
  v_v4:=v_v4 #- '{data,salesOrders}' #- '{data,salesOrderEvents}' #- '{counts,salesOrders}' #- '{counts,salesOrderEvents}';
  perform public.restore_ledger_backup(v_user,'sales-order-v4-preview',v_v4,true);
end;
$$;

rollback;
