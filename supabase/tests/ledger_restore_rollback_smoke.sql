begin;

create temp table ledger_restore_smoke_results (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_user_id uuid;
  v_suffix text := txid_current()::text;
  v_warehouse text := '__restore_smoke_' || txid_current()::text;
  v_package jsonb;
  v_modified jsonb;
  v_result jsonb;
  v_repeat jsonb;
  v_existing_row jsonb;
  v_existing_package jsonb;
  v_audit_id uuid := gen_random_uuid();
  v_existing_product_id text;
  v_many jsonb := '[]'::jsonb;
  v_index integer;
begin
  select id into v_user_id from auth.users order by created_at limit 1;
  if v_user_id is null then raise exception 'Smoke test requires one existing auth user'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_user_id,'role','authenticated')::text, true);

  v_package := jsonb_build_object(
    'schemaVersion','dewu-seller-pro/ledger-backup@1','exportedAt',now()::text,'scope','full-ledger',
    'counts',jsonb_build_object('products',5,'activeProducts',5,'recycledProducts',0,'activities',4,'warehouses',2,'repairs',2),
    'media',jsonb_build_object('included',false,'note','smoke test; no images'),
    'data',jsonb_build_object(
      'warehouses',jsonb_build_array(
        jsonb_build_object('sourceId','w1-'||v_suffix,'name',v_warehouse,'isDefault',false,'createdAt',now()::text),
        jsonb_build_object('sourceId','w2-'||v_suffix,'name',v_warehouse||'-secondary','isDefault',true,'createdAt',now()::text)
      ),
      'products',jsonb_build_array(
        jsonb_build_object('sourceId','p1-'||v_suffix,'name','恢复烟测商品','brand','测试品牌','size','42','sku','SMOKE-'||v_suffix,'cost',10,'stock',2,'status','instock','location','','warehouse',v_warehouse,'source','smoke','createdAt',now()::text,'deletedAt',null),
        jsonb_build_object('sourceId','p1-'||v_suffix,'name','重复源记录','brand','测试品牌','size','43','sku','DUP-'||v_suffix,'cost',10,'stock',1,'status','instock','location','','warehouse',v_warehouse,'source','smoke','createdAt',now()::text,'deletedAt',null),
        jsonb_build_object('sourceId','p2-'||v_suffix,'name','无效仓库商品','brand','测试品牌','size','42','sku','BAD-WH-'||v_suffix,'cost',10,'stock',1,'status','instock','location','','warehouse','不存在仓库','source','smoke','createdAt',now()::text,'deletedAt',null),
        jsonb_build_object('sourceId','p3-'||v_suffix,'name','坏时间商品','brand','测试品牌','size','42','sku','BAD-TIME-'||v_suffix,'cost',10,'stock',1,'status','instock','location','','warehouse',v_warehouse,'source','smoke','createdAt','not-a-time','deletedAt',null),
        'null'::jsonb
      ),
      'activities',jsonb_build_array(
        jsonb_build_object('sourceId','a1-'||v_suffix,'type','inbound','productName','恢复烟测商品','sku','SMOKE-'||v_suffix,'size','42','price',null,'cost',10,'count',2,'warehouse',v_warehouse,'platform','得物','source','smoke','createdAt',now()::text),
        jsonb_build_object('sourceId','a1-'||v_suffix,'type','outbound','productName','重复源记录','sku','SMOKE-'||v_suffix,'size','42','price',20,'cost',10,'count',1,'warehouse',v_warehouse,'platform','得物','source','smoke','createdAt',now()::text),
        jsonb_build_object('sourceId','a2-'||v_suffix,'type','inbound','productName','坏数量流水','sku','BAD-COUNT-'||v_suffix,'size','42','price',null,'cost',10,'count','not-a-number','warehouse',v_warehouse,'platform','得物','source','smoke','createdAt',now()::text),
        'null'::jsonb
      ),
      'repairs',jsonb_build_array(
        jsonb_build_object('sourceId','r1-'||v_suffix,'targetTable','products','recordId','p1-'||v_suffix,'fieldName','stock','oldValue',-1,'newValue',2,'oldStatus','instock','newStatus','instock','reason','事务回滚烟测','createdAt',now()::text),
        jsonb_build_object('sourceId','r2-'||v_suffix,'targetTable','activities','recordId','missing-'||v_suffix,'fieldName','count','oldValue',0,'newValue',1,'oldStatus',null,'newStatus',null,'reason','悬空审计烟测','createdAt',now()::text)
      )
    ),
    'integrity',jsonb_build_object('algorithm','SHA-256','value',repeat('a',64))
  );

  v_result := public.restore_ledger_backup(v_user_id,'preview-'||v_suffix,v_package,true);
  insert into ledger_restore_smoke_results values (
    'dry_run_matches_execution_rules',
    (v_result->>'added')::integer=5 and (v_result->>'merged')::integer=0
      and (v_result->>'conflicts')::integer=8 and (v_result->>'skipped')::integer=0
  );

  v_result := public.restore_ledger_backup(v_user_id,'execute-'||v_suffix,v_package,false);
  v_repeat := public.restore_ledger_backup(v_user_id,'execute-'||v_suffix,v_package,false);
  insert into ledger_restore_smoke_results values ('same_operation_is_idempotent',v_result=v_repeat);
  insert into ledger_restore_smoke_results values (
    'valid_rows_written_once',
    (select count(*)=1 from public.products where user_id=v_user_id and sku='SMOKE-'||v_suffix)
      and (select count(*)=1 from public.activities where user_id=v_user_id and sku='SMOKE-'||v_suffix)
      and (select count(*)=1 from public.warehouses where user_id=v_user_id and name=v_warehouse)
  );
  insert into ledger_restore_smoke_results values (
    'invalid_rows_quarantined',
    (select count(*)=6 from public.ledger_restore_quarantine where user_id=v_user_id and payload_fingerprint=v_result->>'payloadFingerprint')
  );

  v_repeat := public.restore_ledger_backup(v_user_id,'new-operation-'||v_suffix,v_package,false);
  insert into ledger_restore_smoke_results values (
    'new_operation_same_package_does_not_duplicate',
    (v_repeat->>'added')::integer=0
      and (select count(*)=1 from public.products where user_id=v_user_id and sku='SMOKE-'||v_suffix)
      and (select count(*)=1 from public.activities where user_id=v_user_id and sku='SMOKE-'||v_suffix)
  );

  v_modified := jsonb_set(v_package,'{media,note}','"different payload"'::jsonb);
  begin
    perform public.restore_ledger_backup(v_user_id,'execute-'||v_suffix,v_modified,false);
    insert into ledger_restore_smoke_results values ('operation_rejects_different_payload',false);
  exception when others then
    insert into ledger_restore_smoke_results values ('operation_rejects_different_payload',sqlerrm like '%payload does not match%');
  end;

  select jsonb_build_object(
    'sourceId',id,'type',type,'productName',coalesce(product_name,''),'sku',coalesce(sku,''),'size',coalesce(size,''),
    'price',price,'cost',cost,'count',count,'warehouse',coalesce(warehouse,''),'platform',coalesce(platform,''),
    'source',coalesce(source,''),'createdAt',created_at::text
  ) into v_existing_row
  from public.activities
  where user_id=v_user_id and type in ('inbound','outbound','pending','restore','transfer')
    and (count is null or count>0) and (price is null or price>=0) and (cost is null or cost>=0)
  order by created_at limit 1;
  if v_existing_row is null then raise exception 'Smoke test requires one valid existing activity'; end if;
  v_existing_package := jsonb_build_object(
    'schemaVersion','dewu-seller-pro/ledger-backup@1','exportedAt',now()::text,'scope','full-ledger',
    'counts',jsonb_build_object('products',0,'activeProducts',0,'recycledProducts',0,'activities',1,'warehouses',0,'repairs',0),
    'media',jsonb_build_object('included',false,'note','existing source smoke'),
    'data',jsonb_build_object('products','[]'::jsonb,'activities',jsonb_build_array(v_existing_row),'warehouses','[]'::jsonb,'repairs','[]'::jsonb),
    'integrity',jsonb_build_object('algorithm','SHA-256','value',repeat('b',64))
  );
  v_result := public.restore_ledger_backup(v_user_id,'existing-activity-'||v_suffix,v_existing_package,true);
  insert into ledger_restore_smoke_results values ('original_account_activity_is_skipped',(v_result->>'skipped')::integer=1 and (v_result->>'added')::integer=0);

  select id into v_existing_product_id from public.products where user_id=v_user_id order by created_at limit 1;
  if v_existing_product_id is null then raise exception 'Smoke test requires one existing product'; end if;
  insert into public.data_repair_audit (id,user_id,target_table,record_id,field_name,old_value,new_value,reason,created_at)
  values (v_audit_id,v_user_id,'products',v_existing_product_id,'stock',0,1,'原账号审计跳过烟测',now());
  v_existing_package := jsonb_build_object(
    'schemaVersion','dewu-seller-pro/ledger-backup@1','exportedAt',now()::text,'scope','full-ledger',
    'counts',jsonb_build_object('products',0,'activeProducts',0,'recycledProducts',0,'activities',0,'warehouses',0,'repairs',1),
    'media',jsonb_build_object('included',false,'note','existing audit smoke'),
    'data',jsonb_build_object('products','[]'::jsonb,'activities','[]'::jsonb,'warehouses','[]'::jsonb,'repairs',jsonb_build_array(
      jsonb_build_object('sourceId',v_audit_id::text,'targetTable','products','recordId',v_existing_product_id,'fieldName','stock','oldValue',0,'newValue',1,'oldStatus',null,'newStatus',null,'reason','原账号审计跳过烟测','createdAt',now()::text)
    )),
    'integrity',jsonb_build_object('algorithm','SHA-256','value',repeat('c',64))
  );
  v_result := public.restore_ledger_backup(v_user_id,'existing-repair-'||v_suffix,v_existing_package,true);
  insert into ledger_restore_smoke_results values ('original_account_repair_is_skipped',(v_result->>'skipped')::integer=1 and (v_result->>'added')::integer=0);

  v_many := '[]'::jsonb;
  for v_index in 1..101 loop v_many := v_many || 'null'::jsonb; end loop;
  v_existing_package := jsonb_build_object(
    'schemaVersion','dewu-seller-pro/ledger-backup@1','exportedAt',now()::text,'scope','full-ledger',
    'counts',jsonb_build_object('products',0,'activeProducts',0,'recycledProducts',0,'activities',101,'warehouses',0,'repairs',0),
    'media',jsonb_build_object('included',false,'note','details limit smoke'),
    'data',jsonb_build_object('products','[]'::jsonb,'activities',v_many,'warehouses','[]'::jsonb,'repairs','[]'::jsonb),
    'integrity',jsonb_build_object('algorithm','SHA-256','value',repeat('d',64))
  );
  v_result := public.restore_ledger_backup(v_user_id,'details-'||v_suffix,v_existing_package,true);
  insert into ledger_restore_smoke_results values (
    'scalar_rows_conflict_and_details_are_bounded',
    (v_result->>'conflicts')::integer=101 and jsonb_array_length(v_result->'details')=100 and (v_result->>'detailsTruncated')::boolean
  );

  begin
    perform public.restore_ledger_backup(gen_random_uuid(),'unauthorized-'||v_suffix,v_package,true);
    insert into ledger_restore_smoke_results values ('other_user_is_rejected',false);
  exception when others then
    insert into ledger_restore_smoke_results values ('other_user_is_rejected',sqlerrm like '%Unauthorized%');
  end;
end;
$$;

do $$
begin
  if exists(select 1 from ledger_restore_smoke_results where not passed) then
    raise exception 'Ledger restore rollback smoke failed: %', (
      select string_agg(check_name, ', ') from ledger_restore_smoke_results where not passed
    );
  end if;
  if (select count(*) from ledger_restore_smoke_results) <> 10 then
    raise exception 'Ledger restore rollback smoke did not execute every check';
  end if;
end;
$$;

select check_name, passed from ledger_restore_smoke_results order by check_name;

rollback;
