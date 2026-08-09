begin;

do $$
declare
  v_user uuid;
  v_suffix text := txid_current()::text;
  v_activity_source text := 'fee-backup-activity-'||txid_current()::text;
  v_scheme_source text := gen_random_uuid()::text;
  v_package jsonb;
  v_v1 jsonb;
  v_preview jsonb;
  v_first jsonb;
  v_repeat jsonb;
  v_second_operation jsonb;
  v_snapshot jsonb;
  v_scheme_id uuid;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'Smoke test requires one auth user'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);

  v_package:=jsonb_build_object(
    'schemaVersion','dewu-seller-pro/ledger-backup@2','exportedAt',now()::text,'scope','full-ledger',
    'counts',jsonb_build_object('products',0,'activeProducts',0,'recycledProducts',0,'activities',1,'warehouses',0,'repairs',0,'feeSchemes',1),
    'media',jsonb_build_object('included',false,'note','fee backup rollback smoke'),
    'data',jsonb_build_object(
      'products','[]'::jsonb,'warehouses','[]'::jsonb,'repairs','[]'::jsonb,
      'activities',jsonb_build_array(jsonb_build_object(
        'sourceId',v_activity_source,'type','outbound','productName','Fee backup smoke','sku','FEE-BACKUP-'||v_suffix,'size','42',
        'price',100,'cost',70,'count',2,'warehouse','Smoke warehouse','platform','得物','source','smoke','createdAt',now()::text,
        'feeSnapshot',jsonb_build_object('schemaVersion','fee-snapshot@1','status','known','schemeId',v_scheme_source,'percentRate',5,'total',21),
        'estimatedPlatformFee',21,'estimatedNetProceeds',179,'estimatedNetProfit',39
      )),
      'feeSchemes',jsonb_build_array(jsonb_build_object(
        'sourceId',v_scheme_source,'name','Fee backup smoke','saleMode','normal','category','shoes','percentRate',5,
        'percentMin',3,'percentMax',20,'percentageUnit','transaction','fixedFee',2,'fixedFeeUnit','transaction',
        'shippingFee',8,'shippingFeeUnit','transaction','otherFee',1,'otherFeeUnit','transaction','effectiveFrom',now()::text,
        'isDefault',true,'createdAt',now()::text,'updatedAt',now()::text
      ))
    ),
    'integrity',jsonb_build_object('algorithm','SHA-256','value',repeat('b',64))
  );

  v_preview:=public.restore_ledger_backup(v_user,'fee-preview-'||v_suffix,v_package,true);
  if (v_preview->>'added')::integer<>2 or (v_preview->>'conflicts')::integer<>0 then raise exception 'Unexpected v2 preflight result: %',v_preview; end if;

  v_first:=public.restore_ledger_backup(v_user,'fee-execute-'||v_suffix,v_package,false);
  v_repeat:=public.restore_ledger_backup(v_user,'fee-execute-'||v_suffix,v_package,false);
  if v_first is distinct from v_repeat then raise exception 'Same operation did not replay exactly'; end if;
  if (v_first->>'added')::integer<>2 then raise exception 'Fee backup did not restore both records'; end if;

  select fee_snapshot into v_snapshot from public.activities where user_id=v_user and sku='FEE-BACKUP-'||v_suffix;
  if v_snapshot->>'schemaVersion'<>'fee-snapshot@1' or (v_snapshot->>'total')::numeric<>21 then raise exception 'Fee snapshot drifted during restore'; end if;
  if not exists(select 1 from public.activities where user_id=v_user and sku='FEE-BACKUP-'||v_suffix
    and estimated_platform_fee=21 and estimated_net_proceeds=179 and estimated_net_profit=39) then raise exception 'Estimated amounts were not restored'; end if;

  select id into v_scheme_id from public.fee_schemes where user_id=v_user and name='Fee backup smoke';
  if v_scheme_id is null then raise exception 'Fee scheme was not restored'; end if;
  update public.fee_schemes set percent_rate=99 where id=v_scheme_id;
  select fee_snapshot into v_snapshot from public.activities where user_id=v_user and sku='FEE-BACKUP-'||v_suffix;
  if (v_snapshot->>'percentRate')::numeric<>5 then raise exception 'Historical snapshot followed current scheme'; end if;
  if (select count(*) from public.fee_schemes where user_id=v_user and is_default)>1 then raise exception 'Multiple default schemes were restored'; end if;

  v_second_operation:=public.restore_ledger_backup(v_user,'fee-execute-second-'||v_suffix,v_package,false);
  if (v_second_operation->>'skipped')::integer<>2 then raise exception 'Same package with a new operation duplicated records: %',v_second_operation; end if;
  if (select count(*) from public.activities where user_id=v_user and sku='FEE-BACKUP-'||v_suffix)<>1 then raise exception 'Activity duplicated'; end if;
  if (select count(*) from public.fee_schemes where user_id=v_user and name='Fee backup smoke')<>1 then raise exception 'Fee scheme duplicated'; end if;

  v_v1:=v_package#-'{data,feeSchemes}'#-'{counts,feeSchemes}';
  v_v1:=jsonb_set(v_v1,'{schemaVersion}','"dewu-seller-pro/ledger-backup@1"'::jsonb);
  v_v1:=jsonb_set(v_v1,'{data,activities}',(
    select jsonb_agg(value-'feeSnapshot'-'estimatedPlatformFee'-'estimatedNetProceeds'-'estimatedNetProfit')
    from jsonb_array_elements(v_package#>'{data,activities}')
  ));
  perform public.restore_ledger_backup(v_user,'legacy-preview-'||v_suffix,v_v1,true);
end;
$$;

rollback;
