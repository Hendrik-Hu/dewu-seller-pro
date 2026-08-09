begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_warehouse uuid := gen_random_uuid();
  v_other_warehouse uuid := gen_random_uuid();
  v_instance uuid := '00000000-0000-0000-0000-000000000000';
  v_failed boolean := false;
  v_table record;
  v_remaining bigint;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
  values
    (v_user,v_instance,'authenticated','authenticated','delete-smoke-'||v_user||'@example.invalid','',now(),now(),now()),
    (v_other,v_instance,'authenticated','authenticated','delete-other-'||v_other||'@example.invalid','',now(),now(),now());

  insert into public.inbound_batches(user_id,batch_id,request) values(v_user,'delete-smoke-batch','[]'::jsonb);
  insert into public.inventory_transfers(user_id,operation_id,request) values(v_user,'delete-smoke-transfer','{}'::jsonb);
  insert into public.warehouses(id,user_id,name,is_default) values(v_warehouse,v_user,'Delete smoke',true),(v_other_warehouse,v_other,'Other user',true);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  begin
    perform public.delete_current_user_account(v_user,'WRONG');
  exception when others then v_failed := sqlerrm like '%confirmation%'; end;
  if not v_failed or not exists(select 1 from auth.users where id=v_user) then raise exception 'Invalid confirmation was not rejected safely'; end if;

  v_failed := false;
  begin
    perform public.delete_current_user_account(v_other,'DELETE_MY_ACCOUNT');
  exception when others then v_failed := sqlerrm like '%Unauthorized%'; end;
  if not v_failed or not exists(select 1 from auth.users where id=v_other) then raise exception 'Cross-user deletion was not rejected safely'; end if;

  if public.delete_current_user_account(v_user,'DELETE_MY_ACCOUNT') is distinct from true then raise exception 'Deletion did not report success'; end if;
  if exists(select 1 from auth.users where id=v_user) then raise exception 'Auth user remained'; end if;
  if exists(select 1 from public.inbound_batches where user_id=v_user) then raise exception 'Inbound batch remained'; end if;
  if exists(select 1 from public.inventory_transfers where user_id=v_user) then raise exception 'Inventory transfer remained'; end if;
  if exists(select 1 from public.warehouses where user_id=v_user) then raise exception 'Cascaded warehouse remained'; end if;
  if exists(select 1 from public.profiles where id=v_user) then raise exception 'Profile remained'; end if;
  for v_table in
    select distinct c.oid::regclass as table_name
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
    join pg_attribute a on a.attrelid=c.oid and a.attname='user_id' and not a.attisdropped
    where c.relkind in ('r','p')
  loop
    execute format('select count(*) from %s where user_id=$1',v_table.table_name) into v_remaining using v_user;
    if v_remaining <> 0 then raise exception 'User-scoped rows remained in %',v_table.table_name; end if;
  end loop;
  if not exists(select 1 from auth.users where id=v_other) or not exists(select 1 from public.warehouses where user_id=v_other) then raise exception 'Other user data was changed'; end if;
end;
$$;

rollback;
