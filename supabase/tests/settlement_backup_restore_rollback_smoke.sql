begin;

do $$
declare
  v_user uuid;
  v_suffix text:=txid_current()::text;
  v_activity_source text:='settlement-backup-activity-'||v_suffix;
  v_settlement_source text:=extensions.gen_random_uuid()::text;
  v_created_at timestamptz:=now()-interval '2 hours';
  v_settled_at timestamptz:=now()-interval '1 hour';
  v_package jsonb;
  v_preview jsonb;
  v_first jsonb;
  v_repeat jsonb;
  v_second jsonb;
  v_target_activity text;
  v_bad jsonb;
  v_failed boolean;
  v_with_repair jsonb;
  v_repair_source text:=extensions.gen_random_uuid()::text;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'Smoke test requires one auth user'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);

  v_package:=jsonb_build_object(
    'schemaVersion','dewu-seller-pro/ledger-backup@3','exportedAt',now()::text,'scope','full-ledger',
    'counts',jsonb_build_object('products',0,'activeProducts',0,'recycledProducts',0,'activities',1,'warehouses',0,'repairs',0,'feeSchemes',0,'settlements',1),
    'media',jsonb_build_object('included',false,'note','settlement backup rollback smoke'),
    'data',jsonb_build_object(
      'products','[]'::jsonb,'warehouses','[]'::jsonb,'repairs','[]'::jsonb,'feeSchemes','[]'::jsonb,
      'activities',jsonb_build_array(jsonb_build_object(
        'sourceId',v_activity_source,'type','outbound','productName','Settlement backup smoke','sku','SETTLEMENT-BACKUP-'||v_suffix,'size','42',
        'price',100,'cost',70,'count',2,'warehouse','Smoke warehouse','platform','平台','source','smoke','createdAt',v_created_at::text,
        'feeSnapshot',jsonb_build_object('schemaVersion','fee-snapshot@1','status','known','total',20),
        'estimatedPlatformFee',20,'estimatedNetProceeds',180,'estimatedNetProfit',40,
        'actualPlatformFee',35,'actualNetProceeds',165,'actualNetProfit',25,'settledAt',v_settled_at::text,
        'settlementOrderNo','ORDER-BACKUP','settlementNote','实际结算','settlementRevision',1
      )),
      'settlements',jsonb_build_array(jsonb_build_object(
        'sourceId',v_settlement_source,'activitySourceId',v_activity_source,'revision',1,'previousSnapshot',null,
        'settlementSnapshot',jsonb_build_object('schemaVersion','outbound-settlement@1','activityId',v_activity_source,'grossAmount',200,'quantity',2,
          'frozenUnitCost',70,'actualPlatformFee',35,'actualNetProceeds',165,'actualNetProfit',25,'settledAt',v_settled_at,'orderNo','ORDER-BACKUP','note','实际结算','revision',1),
        'createdAt',v_settled_at::text
      ))
    ),
    'integrity',jsonb_build_object('algorithm','SHA-256','value',repeat('c',64))
  );

  v_preview:=public.restore_ledger_backup(v_user,'settlement-preview-'||v_suffix,v_package,true);
  if (v_preview->>'added')::integer<>2 or (v_preview->>'conflicts')::integer<>0 then raise exception 'Unexpected settlement preflight: %',v_preview; end if;

  v_bad:=jsonb_set(jsonb_set(v_package,'{data,activities,0,actualNetProceeds}','999'::jsonb),'{data,settlements,0,settlementSnapshot,actualNetProceeds}','999'::jsonb);
  v_failed:=false; begin perform public.restore_ledger_backup(v_user,'bad-money-'||v_suffix,v_bad,true); exception when others then v_failed:=sqlerrm like '%Settlement chain is invalid%'; end;
  if not v_failed then raise exception 'Forged settlement arithmetic passed preflight'; end if;
  v_bad:=jsonb_set(v_package,'{data,activities,0,type}','"inbound"'::jsonb);
  v_failed:=false; begin perform public.restore_ledger_backup(v_user,'bad-type-'||v_suffix,v_bad,true); exception when others then v_failed:=sqlerrm like '%Settlement chain is invalid%'; end;
  if not v_failed then raise exception 'Inbound activity carried settlement data'; end if;
  v_bad:=jsonb_set(v_package,'{data,activities,0,settlementRevision}','2'::jsonb);
  v_failed:=false; begin perform public.restore_ledger_backup(v_user,'bad-gap-'||v_suffix,v_bad,true); exception when others then v_failed:=sqlerrm like '%Settlement chain is invalid%'; end;
  if not v_failed then raise exception 'Settlement revision gap passed preflight'; end if;
  v_bad:=jsonb_set(v_package,'{data,activities,0,actualPlatformFee}','36'::jsonb);
  v_failed:=false; begin perform public.restore_ledger_backup(v_user,'bad-current-'||v_suffix,v_bad,true); exception when others then v_failed:=sqlerrm like '%Settlement chain is invalid%'; end;
  if not v_failed then raise exception 'Current settlement mismatch passed preflight'; end if;
  v_bad:=v_package#-'{data,settlements,0,settlementSnapshot,actualNetProceeds}';
  v_failed:=false; begin perform public.restore_ledger_backup(v_user,'bad-missing-key-'||v_suffix,v_bad,true); exception when others then v_failed:=sqlerrm like '%Settlement chain is invalid%'; end;
  if not v_failed then raise exception 'Settlement snapshot with a missing required key passed preflight'; end if;

  v_first:=public.restore_ledger_backup(v_user,'settlement-execute-'||v_suffix,v_package,false);
  v_repeat:=public.restore_ledger_backup(v_user,'settlement-execute-'||v_suffix,v_package,false);
  if v_first is distinct from v_repeat or (v_first->>'added')::integer<>2 then raise exception 'Settlement restore replay failed: % / %',v_first,v_repeat; end if;
  select id into v_target_activity from public.activities where user_id=v_user and sku='SETTLEMENT-BACKUP-'||v_suffix;
  if not exists(select 1 from public.activities where id=v_target_activity and actual_platform_fee=35 and actual_net_proceeds=165 and actual_net_profit=25
    and settlement_order_no='ORDER-BACKUP' and settlement_note='实际结算' and settlement_revision=1) then raise exception 'Current settlement snapshot was not restored'; end if;
  if not exists(select 1 from public.outbound_settlement_audit where user_id=v_user and activity_id=v_target_activity and revision=1
    and (settlement_snapshot->>'actualPlatformFee')::numeric=35) then raise exception 'Settlement audit was not restored'; end if;

  v_second:=public.restore_ledger_backup(v_user,'settlement-execute-second-'||v_suffix,v_package,false);
  if (v_second->>'skipped')::integer<>2 then raise exception 'New operation duplicated settlement package: %',v_second; end if;
  if (select count(*) from public.activities where user_id=v_user and sku='SETTLEMENT-BACKUP-'||v_suffix)<>1 then raise exception 'Restored activity duplicated'; end if;
  if (select count(*) from public.outbound_settlement_audit where user_id=v_user and activity_id=v_target_activity)<>1 then raise exception 'Restored settlement audit duplicated'; end if;

  v_with_repair:=jsonb_set(v_package,'{data,repairs}',jsonb_build_array(jsonb_build_object(
    'sourceId',v_repair_source,'targetTable','activities','recordId',v_activity_source,'fieldName','count','oldValue',0,'newValue',2,
    'oldStatus',null,'newStatus',null,'reason','恢复映射烟测','createdAt',now()::text
  )));
  v_with_repair:=jsonb_set(v_with_repair,'{counts,repairs}','1'::jsonb);
  v_failed:=false;
  begin perform public.restore_ledger_backup(v_user,'settlement-repair-preview-'||v_suffix,v_with_repair,true);
  exception when others then v_failed:=sqlerrm like '%different generation%'; end;
  if not v_failed then raise exception 'A changed backup generation was allowed to layer over restored source records'; end if;
end;
$$;

rollback;
