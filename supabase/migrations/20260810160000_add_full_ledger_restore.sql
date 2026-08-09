begin;

create extension if not exists pgcrypto;

create table if not exists public.ledger_restore_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  client_hash text not null,
  payload_fingerprint text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

create table if not exists public.ledger_restore_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  payload_fingerprint text not null,
  entity_type text not null check (entity_type in ('warehouse', 'product', 'activity', 'repair')),
  source_id text not null,
  target_id text not null,
  restored_at timestamptz not null default now(),
  primary key (user_id, payload_fingerprint, entity_type, source_id)
);

create table if not exists public.ledger_restore_quarantine (
  user_id uuid not null references auth.users(id) on delete cascade,
  payload_fingerprint text not null,
  entity_type text not null check (entity_type in ('warehouse', 'product', 'activity', 'repair')),
  source_id text not null,
  payload jsonb not null,
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, payload_fingerprint, entity_type, source_id)
);

alter table public.ledger_restore_operations enable row level security;
alter table public.ledger_restore_items enable row level security;
alter table public.ledger_restore_quarantine enable row level security;
drop policy if exists ledger_restore_quarantine_select_own on public.ledger_restore_quarantine;
create policy ledger_restore_quarantine_select_own on public.ledger_restore_quarantine for select to authenticated using (auth.uid()=user_id);
revoke all on table public.ledger_restore_operations, public.ledger_restore_items, public.ledger_restore_quarantine from public, anon, authenticated;
grant select on table public.ledger_restore_quarantine to authenticated;

create or replace function public.restore_ledger_backup(
  p_user_id uuid,
  p_operation_id text,
  p_package jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_hash text := p_package#>>'{integrity,value}';
  v_fingerprint text := encode(extensions.digest(convert_to(p_package::text, 'UTF8'), 'sha256'), 'hex');
  v_row jsonb;
  v_source_id text;
  v_target_id text;
  v_name text;
  v_sku text;
  v_size text;
  v_warehouse text;
  v_key text;
  v_stock integer;
  v_cost numeric;
  v_count numeric;
  v_price numeric;
  v_status text;
  v_type text;
  v_added integer := 0;
  v_merged integer := 0;
  v_conflicts integer := 0;
  v_skipped integer := 0;
  v_current_warehouse_count integer;
  v_planned_warehouses integer := 0;
  v_existing_result jsonb;
  v_existing_fingerprint text;
  v_details jsonb := '[]'::jsonb;
  v_details_truncated boolean := false;
  v_seen_active_keys text[] := array[]::text[];
  v_seen_warehouse_sources text[] := array[]::text[];
  v_seen_warehouse_names text[] := array[]::text[];
  v_seen_product_sources text[] := array[]::text[];
  v_seen_activity_sources text[] := array[]::text[];
  v_seen_repair_sources text[] := array[]::text[];
  v_restorable_product_sources text[] := array[]::text[];
  v_restorable_activity_sources text[] := array[]::text[];
  v_result jsonb;
  v_record_id text;
  v_audit_id uuid;
  v_restorable_warehouses text[] := array[]::text[];
  v_parse_ok boolean;
  v_created_at timestamptz;
  v_deleted_at timestamptz;
  v_old_value numeric;
  v_new_value numeric;
  v_item_index integer := 0;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if trim(coalesce(p_operation_id, '')) = '' then raise exception 'Restore operation id is required'; end if;
  if length(p_operation_id) > 200 then raise exception 'Restore operation id is too long'; end if;
  if pg_column_size(p_package) > 26214400 then raise exception 'Ledger backup exceeds 25MB'; end if;
  if p_package->>'schemaVersion' <> 'dewu-seller-pro/ledger-backup@1' then raise exception 'Unsupported ledger backup schema'; end if;
  if p_package->>'scope' <> 'full-ledger' then raise exception 'Invalid ledger backup scope'; end if;
  if v_client_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid ledger backup integrity hash'; end if;
  if jsonb_typeof(p_package->'counts')<>'object' or jsonb_typeof(p_package->'data')<>'object'
    or jsonb_typeof(p_package->'media')<>'object' or jsonb_typeof(p_package->'integrity')<>'object'
  then raise exception 'Ledger backup metadata is invalid'; end if;
  if exists(select 1 from jsonb_object_keys(p_package) key where key not in ('schemaVersion','exportedAt','scope','counts','media','data','integrity')) then
    raise exception 'Ledger backup contains unsupported top-level fields';
  end if;
  if exists(select 1 from jsonb_object_keys(p_package->'counts') key where key not in ('products','activeProducts','recycledProducts','activities','warehouses','repairs'))
    or exists(select 1 from jsonb_object_keys(p_package->'data') key where key not in ('products','activities','warehouses','repairs'))
    or exists(select 1 from jsonb_object_keys(p_package->'media') key where key not in ('included','note'))
    or exists(select 1 from jsonb_object_keys(p_package->'integrity') key where key not in ('algorithm','value'))
  then raise exception 'Ledger backup metadata contains unsupported fields'; end if;
  if p_package#>>'{integrity,algorithm}' <> 'SHA-256' or p_package#>'{media,included}' <> 'false'::jsonb
    or jsonb_typeof(p_package->'exportedAt')<>'string'
    or jsonb_typeof(p_package#>'{integrity,algorithm}')<>'string' or jsonb_typeof(p_package#>'{integrity,value}')<>'string'
    or jsonb_typeof(p_package#>'{media,note}')<>'string' or length(coalesce(p_package#>>'{media,note}',''))>1000
    or jsonb_typeof(p_package#>'{counts,products}')<>'number' or jsonb_typeof(p_package#>'{counts,activeProducts}')<>'number'
    or jsonb_typeof(p_package#>'{counts,recycledProducts}')<>'number' or jsonb_typeof(p_package#>'{counts,activities}')<>'number'
    or jsonb_typeof(p_package#>'{counts,warehouses}')<>'number' or jsonb_typeof(p_package#>'{counts,repairs}')<>'number'
  then raise exception 'Ledger backup metadata is invalid'; end if;
  begin
    v_created_at := (p_package->>'exportedAt')::timestamptz;
  exception when others then raise exception 'Ledger backup export time is invalid'; end;
  if jsonb_typeof(p_package#>'{data,products}') <> 'array'
    or jsonb_typeof(p_package#>'{data,activities}') <> 'array'
    or jsonb_typeof(p_package#>'{data,warehouses}') <> 'array'
    or jsonb_typeof(p_package#>'{data,repairs}') <> 'array'
  then raise exception 'Ledger backup data is incomplete'; end if;
  begin
    if jsonb_array_length(p_package#>'{data,products}') <> (p_package#>>'{counts,products}')::integer
      or jsonb_array_length(p_package#>'{data,activities}') <> (p_package#>>'{counts,activities}')::integer
      or jsonb_array_length(p_package#>'{data,warehouses}') <> (p_package#>>'{counts,warehouses}')::integer
      or jsonb_array_length(p_package#>'{data,repairs}') <> (p_package#>>'{counts,repairs}')::integer
      or (p_package#>>'{counts,activeProducts}')::integer + (p_package#>>'{counts,recycledProducts}')::integer <> (p_package#>>'{counts,products}')::integer
    then raise exception 'Ledger backup count validation failed'; end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Ledger backup counts are invalid';
  end;
  if jsonb_array_length(p_package#>'{data,products}') > 10000
    or jsonb_array_length(p_package#>'{data,activities}') > 50000
    or jsonb_array_length(p_package#>'{data,warehouses}') > 100
    or jsonb_array_length(p_package#>'{data,repairs}') > 50000
  then raise exception 'Ledger backup exceeds restore limits'; end if;

  if not p_dry_run then
    perform pg_advisory_xact_lock(hashtextextended('ledger-restore:' || p_user_id::text, 0));
    insert into public.ledger_restore_operations (user_id, operation_id, client_hash, payload_fingerprint)
    values (p_user_id, p_operation_id, v_client_hash, v_fingerprint)
    on conflict (user_id, operation_id) do nothing;
    if not found then
      select payload_fingerprint, result into v_existing_fingerprint, v_existing_result
      from public.ledger_restore_operations where user_id = p_user_id and operation_id = p_operation_id;
      if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'Restore operation payload does not match original package'; end if;
      if v_existing_result is null then raise exception 'Restore operation is still processing'; end if;
      return v_existing_result;
    end if;
  end if;

  select count(*) into v_current_warehouse_count from public.warehouses where user_id = p_user_id;
  select coalesce(array_agg(name),array[]::text[]) into v_restorable_warehouses from public.warehouses where user_id=p_user_id;

  v_item_index := 0;
  for v_row in select value from jsonb_array_elements(p_package#>'{data,warehouses}') loop
    v_item_index := v_item_index + 1;
    v_source_id := trim(coalesce(v_row->>'sourceId', ''));
    v_name := trim(coalesce(v_row->>'name', ''));
    v_parse_ok := true;
    begin
      v_created_at := coalesce(nullif(v_row->>'createdAt','')::timestamptz, now());
      if jsonb_typeof(v_row->'isDefault') not in ('boolean','null') then v_parse_ok := false; end if;
    exception when others then v_parse_ok := false; v_created_at := null; end;
    if jsonb_typeof(v_row)<>'object' or jsonb_typeof(v_row->'sourceId')<>'string' or jsonb_typeof(v_row->'name')<>'string'
      or jsonb_typeof(v_row->'createdAt')<>'string' or v_source_id = '' or length(v_source_id)>256 or v_name = '' or length(v_name)>120 or not v_parse_ok
      or exists(select 1 from jsonb_object_keys(case when jsonb_typeof(v_row)='object' then v_row else '{}'::jsonb end) key where key not in ('sourceId','name','isDefault','createdAt'))
    then
      v_conflicts := v_conflicts + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object('entity','warehouse','sourceId',v_source_id,'outcome','conflict','reason','仓库标识或名称为空'));
      if not p_dry_run then
        insert into public.ledger_restore_quarantine values (p_user_id,v_fingerprint,'warehouse',coalesce(nullif(v_source_id,''),'#row-'||v_item_index),v_row,'仓库字段或时间无效',now()) on conflict do nothing;
      end if;
    elsif v_source_id = any(v_seen_warehouse_sources) then
      v_conflicts := v_conflicts + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object('entity','warehouse','sourceId',v_source_id,'outcome','conflict','reason','账本包内仓库 sourceId 重复'));
    elsif exists (select 1 from public.ledger_restore_items where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='warehouse' and source_id=v_source_id) then
      v_skipped := v_skipped + 1;
    elsif exists (select 1 from public.ledger_restore_quarantine where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='warehouse' and source_id=v_source_id) then
      v_skipped := v_skipped + 1;
    elsif exists (select 1 from public.warehouses where user_id=p_user_id and id::text=v_source_id) then
      v_skipped := v_skipped + 1;
      if not p_dry_run then
        select id::text into v_target_id from public.warehouses where user_id=p_user_id and id::text=v_source_id;
        insert into public.ledger_restore_items values (p_user_id,v_fingerprint,'warehouse',v_source_id,v_target_id,now()) on conflict do nothing;
      end if;
    elsif exists (select 1 from public.warehouses where user_id=p_user_id and name=v_name) then
      v_merged := v_merged + 1;
      if not (v_name=any(v_restorable_warehouses)) then v_restorable_warehouses:=array_append(v_restorable_warehouses,v_name); end if;
      if not p_dry_run then
        select id::text into v_target_id from public.warehouses where user_id=p_user_id and name=v_name;
        insert into public.ledger_restore_items values (p_user_id,v_fingerprint,'warehouse',v_source_id,v_target_id,now()) on conflict do nothing;
      end if;
    elsif v_name = any(v_seen_warehouse_names) then
      v_merged := v_merged + 1;
    elsif v_current_warehouse_count + v_planned_warehouses >= 6 then
      v_conflicts := v_conflicts + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object('entity','warehouse','sourceId',v_source_id,'outcome','conflict','reason','恢复后仓库数量将超过6个'));
    else
      v_added := v_added + 1;
      v_planned_warehouses := v_planned_warehouses + 1;
      v_restorable_warehouses:=array_append(v_restorable_warehouses,v_name);
      if not p_dry_run then
        insert into public.warehouses (user_id,name,is_default,created_at)
        values (p_user_id,v_name,
          coalesce((v_row->>'isDefault')::boolean,false) and not exists(select 1 from public.warehouses where user_id=p_user_id and is_default),
          v_created_at) returning id::text into v_target_id;
        insert into public.ledger_restore_items values (p_user_id,v_fingerprint,'warehouse',v_source_id,v_target_id,now());
      end if;
    end if;
    if v_source_id<>'' and not (v_source_id=any(v_seen_warehouse_sources)) then v_seen_warehouse_sources:=array_append(v_seen_warehouse_sources,v_source_id); end if;
    if v_name<>'' and not (v_name=any(v_seen_warehouse_names)) and (v_name=any(v_restorable_warehouses)) then v_seen_warehouse_names:=array_append(v_seen_warehouse_names,v_name); end if;
    if jsonb_array_length(v_details)>100 then v_details:=v_details-100; v_details_truncated:=true; end if;
  end loop;

  v_item_index := 0;
  for v_row in select value from jsonb_array_elements(p_package#>'{data,products}') loop
    v_item_index := v_item_index + 1;
    v_source_id := trim(coalesce(v_row->>'sourceId', ''));
    v_sku := upper(trim(coalesce(v_row->>'sku', '')));
    v_size := trim(coalesce(v_row->>'size', ''));
    v_warehouse := trim(coalesce(v_row->>'warehouse', ''));
    v_name := trim(coalesce(v_row->>'name', ''));
    v_status := trim(coalesce(v_row->>'status', ''));
    v_parse_ok:=true;
    begin
      v_stock := (v_row->>'stock')::integer; v_cost := (v_row->>'cost')::numeric;
      v_created_at:=coalesce(nullif(v_row->>'createdAt','')::timestamptz,now());
      v_deleted_at:=nullif(v_row->>'deletedAt','')::timestamptz;
    exception when others then v_parse_ok:=false; v_stock:=null; v_cost:=null; v_created_at:=null; v_deleted_at:=null; end;
    v_key := v_sku || chr(31) || v_size || chr(31) || v_warehouse;
    if not p_dry_run and v_sku<>'' and v_size<>'' and v_warehouse<>'' then
      perform pg_advisory_xact_lock(hashtextextended(
        p_user_id::text || E'\x1f' || v_sku || E'\x1f' || v_size || E'\x1f' || v_warehouse,
        0
      ));
    end if;

    if jsonb_typeof(v_row)<>'object' or jsonb_typeof(v_row->'sourceId')<>'string' or jsonb_typeof(v_row->'sku')<>'string'
      or jsonb_typeof(v_row->'size')<>'string' or jsonb_typeof(v_row->'name')<>'string' or jsonb_typeof(v_row->'brand')<>'string'
      or jsonb_typeof(v_row->'warehouse')<>'string' or jsonb_typeof(v_row->'createdAt')<>'string'
      or jsonb_typeof(v_row->'stock')<>'number' or jsonb_typeof(v_row->'cost') not in ('number','null')
      or jsonb_typeof(v_row->'deletedAt') not in ('string','null')
      or v_source_id='' or length(v_source_id)>256 or v_sku='' or length(v_sku)>100 or v_size='' or length(v_size)>50
      or v_warehouse='' or length(v_warehouse)>120 or v_name='' or length(v_name)>300
      or length(coalesce(v_row->>'brand',''))>120 or length(coalesce(v_row->>'location',''))>300 or length(coalesce(v_row->>'source',''))>500
      or exists(select 1 from jsonb_object_keys(case when jsonb_typeof(v_row)='object' then v_row else '{}'::jsonb end) key where key not in ('sourceId','name','brand','size','sku','cost','stock','status','location','warehouse','source','createdAt','deletedAt'))
      or not v_parse_ok
      or trim(coalesce(v_row->>'createdAt',''))='' or v_stock is null or v_stock < 0 or (v_cost is not null and v_cost < 0)
      or v_status not in ('instock','shipping','sold','flaw')
      or not (v_warehouse=any(v_restorable_warehouses))
    then
      v_conflicts := v_conflicts + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object('entity','product','sourceId',v_source_id,'outcome','conflict','reason','商品字段、数值、状态或仓库无效'));
      if not p_dry_run then
        insert into public.ledger_restore_quarantine values (p_user_id,v_fingerprint,'product',coalesce(nullif(v_source_id,''),'#row-'||v_item_index),v_row,'商品字段、数值、状态或仓库无效',now()) on conflict do nothing;
      end if;
    elsif v_source_id = any(v_seen_product_sources) then
      v_conflicts := v_conflicts + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object('entity','product','sourceId',v_source_id,'outcome','conflict','reason','账本包内商品 sourceId 重复'));
    elsif exists (select 1 from public.ledger_restore_items where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='product' and source_id=v_source_id) then
      v_skipped := v_skipped + 1;
      v_restorable_product_sources:=array_append(v_restorable_product_sources,v_source_id);
    elsif exists (select 1 from public.ledger_restore_quarantine where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='product' and source_id=v_source_id) then
      v_skipped := v_skipped + 1;
    elsif exists (select 1 from public.products where user_id=p_user_id and id=v_source_id) then
      v_skipped := v_skipped + 1;
      v_restorable_product_sources:=array_append(v_restorable_product_sources,v_source_id);
      if not p_dry_run then
        insert into public.ledger_restore_items values (p_user_id,v_fingerprint,'product',v_source_id,v_source_id,now()) on conflict do nothing;
      end if;
    elsif v_deleted_at is null and (v_key = any(v_seen_active_keys)
      or exists(select 1 from public.products where user_id=p_user_id and deleted_at is null
        and upper(trim(coalesce(sku,'')))=v_sku and trim(coalesce(size,''))=v_size and trim(coalesce(warehouse,''))=v_warehouse))
    then
      v_conflicts := v_conflicts + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object('entity','product','sourceId',v_source_id,'outcome','conflict','reason','当前账号已有同货号、尺码和仓库商品，默认不覆盖'));
    else
      if v_deleted_at is null then v_seen_active_keys := array_append(v_seen_active_keys,v_key); end if;
      v_added := v_added + 1;
      v_restorable_product_sources:=array_append(v_restorable_product_sources,v_source_id);
      if not p_dry_run then
        v_target_id := 'restore-' || md5(p_user_id::text || v_fingerprint || 'product' || v_source_id);
        insert into public.products (id,name,brand,size,sku,price,stock,image_url,status,location,created_at,warehouse,user_id,deleted_at,source)
        values (v_target_id,v_name,coalesce(nullif(trim(v_row->>'brand'),''),'未知品牌'),v_size,v_sku,v_cost,v_stock,'',v_status,
          trim(coalesce(v_row->>'location','')),v_created_at,v_warehouse,p_user_id,v_deleted_at,trim(coalesce(v_row->>'source','')));
        insert into public.ledger_restore_items values (p_user_id,v_fingerprint,'product',v_source_id,v_target_id,now());
      end if;
    end if;
    if v_source_id<>'' and not (v_source_id=any(v_seen_product_sources)) then v_seen_product_sources:=array_append(v_seen_product_sources,v_source_id); end if;
    if jsonb_array_length(v_details)>100 then v_details:=v_details-100; v_details_truncated:=true; end if;
  end loop;

  v_item_index := 0;
  for v_row in select value from jsonb_array_elements(p_package#>'{data,activities}') loop
    v_item_index := v_item_index + 1;
    v_source_id := trim(coalesce(v_row->>'sourceId',''));
    v_type := trim(coalesce(v_row->>'type',''));
    v_parse_ok:=true;
    begin
      v_count := case when v_row->'count' = 'null'::jsonb then null else (v_row->>'count')::numeric end;
      v_price := case when v_row->'price' = 'null'::jsonb then null else (v_row->>'price')::numeric end;
      v_cost := case when v_row->'cost' = 'null'::jsonb then null else (v_row->>'cost')::numeric end;
      v_created_at:=coalesce(nullif(v_row->>'createdAt','')::timestamptz,now());
    exception when others then v_parse_ok:=false; v_count:=-1; v_price:=-1; v_cost:=-1; v_created_at:=null; end;
    if jsonb_typeof(v_row)<>'object' or jsonb_typeof(v_row->'sourceId')<>'string' or jsonb_typeof(v_row->'type')<>'string'
      or jsonb_typeof(v_row->'productName')<>'string' or jsonb_typeof(v_row->'sku')<>'string' or jsonb_typeof(v_row->'size')<>'string'
      or jsonb_typeof(v_row->'warehouse')<>'string' or jsonb_typeof(v_row->'platform')<>'string' or jsonb_typeof(v_row->'source')<>'string'
      or jsonb_typeof(v_row->'createdAt')<>'string' or jsonb_typeof(v_row->'count') not in ('number','null')
      or jsonb_typeof(v_row->'price') not in ('number','null') or jsonb_typeof(v_row->'cost') not in ('number','null')
      or v_source_id='' or length(v_source_id)>256 or v_type not in ('inbound','outbound','pending','restore','transfer')
      or length(coalesce(v_row->>'productName',''))>300 or length(coalesce(v_row->>'sku',''))>100 or length(coalesce(v_row->>'size',''))>50
      or length(coalesce(v_row->>'warehouse',''))>120 or length(coalesce(v_row->>'platform',''))>120 or length(coalesce(v_row->>'source',''))>500
      or exists(select 1 from jsonb_object_keys(case when jsonb_typeof(v_row)='object' then v_row else '{}'::jsonb end) key where key not in ('sourceId','type','productName','sku','size','price','cost','count','warehouse','platform','source','createdAt'))
      or trim(coalesce(v_row->>'createdAt',''))='' or not v_parse_ok
      or (v_count is not null and v_count <= 0) or (v_price is not null and v_price < 0) or (v_cost is not null and v_cost < 0)
    then
      v_conflicts := v_conflicts + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object('entity','activity','sourceId',v_source_id,'outcome','conflict','reason','流水类型、数量或金额无效；异常历史不会自动修复'));
      if not p_dry_run then
        insert into public.ledger_restore_quarantine values (p_user_id,v_fingerprint,'activity',coalesce(nullif(v_source_id,''),'#row-'||v_item_index),v_row,'流水类型、数量或金额无效；异常历史不会自动修复',now()) on conflict do nothing;
      end if;
    elsif v_source_id = any(v_seen_activity_sources) then
      v_conflicts := v_conflicts + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object('entity','activity','sourceId',v_source_id,'outcome','conflict','reason','账本包内流水 sourceId 重复'));
    elsif exists (select 1 from public.ledger_restore_items where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='activity' and source_id=v_source_id) then
      v_skipped := v_skipped + 1;
      v_restorable_activity_sources:=array_append(v_restorable_activity_sources,v_source_id);
    elsif exists (select 1 from public.ledger_restore_quarantine where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='activity' and source_id=v_source_id) then
      v_skipped := v_skipped + 1;
    elsif exists (select 1 from public.activities where user_id=p_user_id and id=v_source_id) then
      v_skipped := v_skipped + 1;
      v_restorable_activity_sources:=array_append(v_restorable_activity_sources,v_source_id);
      if not p_dry_run then
        insert into public.ledger_restore_items values (p_user_id,v_fingerprint,'activity',v_source_id,v_source_id,now()) on conflict do nothing;
      end if;
    else
      v_added := v_added + 1;
      v_restorable_activity_sources:=array_append(v_restorable_activity_sources,v_source_id);
      if not p_dry_run then
        v_target_id := 'restore-' || md5(p_user_id::text || v_fingerprint || 'activity' || v_source_id);
        insert into public.activities (id,type,product_name,time,sku,size,price,cost,image_url,created_at,warehouse,count,user_id,platform,source)
        values (v_target_id,v_type,trim(coalesce(v_row->>'productName','')),'已恢复',upper(trim(coalesce(v_row->>'sku',''))),
          trim(coalesce(v_row->>'size','')),v_price,v_cost,'',v_created_at,
          trim(coalesce(v_row->>'warehouse','')),v_count,p_user_id,trim(coalesce(v_row->>'platform','')),trim(coalesce(v_row->>'source','')));
        insert into public.ledger_restore_items values (p_user_id,v_fingerprint,'activity',v_source_id,v_target_id,now());
      end if;
    end if;
    if v_source_id<>'' and not (v_source_id=any(v_seen_activity_sources)) then v_seen_activity_sources:=array_append(v_seen_activity_sources,v_source_id); end if;
    if jsonb_array_length(v_details)>100 then v_details:=v_details-100; v_details_truncated:=true; end if;
  end loop;

  v_item_index := 0;
  for v_row in select value from jsonb_array_elements(p_package#>'{data,repairs}') loop
    v_item_index := v_item_index + 1;
    v_source_id := trim(coalesce(v_row->>'sourceId',''));
    v_parse_ok:=true;
    begin
      v_old_value:=(v_row->>'oldValue')::numeric; v_new_value:=(v_row->>'newValue')::numeric;
      v_created_at:=coalesce(nullif(v_row->>'createdAt','')::timestamptz,now());
    exception when others then v_parse_ok:=false; v_old_value:=null; v_new_value:=null; v_created_at:=null; end;
    if jsonb_typeof(v_row)<>'object' or jsonb_typeof(v_row->'sourceId')<>'string' or jsonb_typeof(v_row->'targetTable')<>'string'
      or jsonb_typeof(v_row->'recordId')<>'string' or jsonb_typeof(v_row->'fieldName')<>'string'
      or jsonb_typeof(v_row->'oldValue')<>'number' or jsonb_typeof(v_row->'newValue')<>'number'
      or jsonb_typeof(v_row->'reason')<>'string' or jsonb_typeof(v_row->'createdAt')<>'string'
      or jsonb_typeof(v_row->'oldStatus') not in ('string','null') or jsonb_typeof(v_row->'newStatus') not in ('string','null')
      or v_source_id='' or length(v_source_id)>256 or (v_row->>'targetTable') not in ('products','activities') or (v_row->>'fieldName') not in ('stock','count')
      or exists(select 1 from jsonb_object_keys(case when jsonb_typeof(v_row)='object' then v_row else '{}'::jsonb end) key where key not in ('sourceId','targetTable','recordId','fieldName','oldValue','newValue','oldStatus','newStatus','reason','createdAt'))
      or trim(coalesce(v_row->>'createdAt',''))='' or not v_parse_ok or length(coalesce(v_row->>'recordId',''))>256 or length(coalesce(v_row->>'reason',''))>1000
      or length(coalesce(v_row->>'oldStatus',''))>30 or length(coalesce(v_row->>'newStatus',''))>30
      or (nullif(v_row->>'oldStatus','') is not null and v_row->>'oldStatus' not in ('instock','shipping','sold','flaw'))
      or (nullif(v_row->>'newStatus','') is not null and v_row->>'newStatus' not in ('instock','shipping','sold','flaw'))
      or length(trim(coalesce(v_row->>'reason',''))) < 3
    then
      v_conflicts := v_conflicts + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object('entity','repair','sourceId',v_source_id,'outcome','conflict','reason','修复审计字段无效'));
      if not p_dry_run then
        insert into public.ledger_restore_quarantine values (p_user_id,v_fingerprint,'repair',coalesce(nullif(v_source_id,''),'#row-'||v_item_index),v_row,'修复审计字段无效',now()) on conflict do nothing;
      end if;
    elsif v_source_id = any(v_seen_repair_sources) then
      v_conflicts := v_conflicts + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object('entity','repair','sourceId',v_source_id,'outcome','conflict','reason','账本包内修复记录 sourceId 重复'));
    elsif exists (select 1 from public.ledger_restore_items where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='repair' and source_id=v_source_id) then
      v_skipped := v_skipped + 1;
    elsif exists (select 1 from public.ledger_restore_quarantine where user_id=p_user_id and payload_fingerprint=v_fingerprint and entity_type='repair' and source_id=v_source_id) then
      v_skipped := v_skipped + 1;
    elsif exists (select 1 from public.data_repair_audit where user_id=p_user_id and id::text=v_source_id) then
      v_skipped := v_skipped + 1;
      if not p_dry_run then
        insert into public.ledger_restore_items values (p_user_id,v_fingerprint,'repair',v_source_id,v_source_id,now()) on conflict do nothing;
      end if;
    else
      v_record_id := trim(coalesce(v_row->>'recordId',''));
      select target_id into v_target_id from public.ledger_restore_items
        where user_id=p_user_id and payload_fingerprint=v_fingerprint
          and entity_type=case when v_row->>'targetTable'='products' then 'product' else 'activity' end
          and source_id=v_record_id;
      if v_target_id is null and v_row->>'targetTable'='products' then
        select id into v_target_id from public.products where user_id=p_user_id and id=v_record_id;
      elsif v_target_id is null and v_row->>'targetTable'='activities' then
        select id into v_target_id from public.activities where user_id=p_user_id and id=v_record_id;
      end if;
      if p_dry_run and v_target_id is null and (
        (v_row->>'targetTable'='products' and v_record_id=any(v_restorable_product_sources))
        or (v_row->>'targetTable'='activities' and v_record_id=any(v_restorable_activity_sources))
      ) then v_target_id := '__planned__'; end if;
      if v_target_id is null then
        v_conflicts:=v_conflicts+1;
        v_details:=v_details||jsonb_build_array(jsonb_build_object('entity','repair','sourceId',v_source_id,'outcome','conflict','reason','修复目标未恢复，审计已隔离'));
        if not p_dry_run then insert into public.ledger_restore_quarantine values (p_user_id,v_fingerprint,'repair',v_source_id,v_row,'修复目标未恢复，审计已隔离',now()) on conflict do nothing; end if;
      else
        v_added := v_added + 1;
        if not p_dry_run then
        v_record_id := v_target_id;
        v_target_id := md5(p_user_id::text || v_fingerprint || 'repair' || v_source_id);
        v_audit_id := (substr(v_target_id,1,8)||'-'||substr(v_target_id,9,4)||'-'||substr(v_target_id,13,4)||'-'||substr(v_target_id,17,4)||'-'||substr(v_target_id,21,12))::uuid;
        insert into public.data_repair_audit (id,user_id,target_table,record_id,field_name,old_value,new_value,old_status,new_status,reason,created_at)
        values (v_audit_id,p_user_id,v_row->>'targetTable',v_record_id,v_row->>'fieldName',v_old_value,v_new_value,
          nullif(v_row->>'oldStatus',''),nullif(v_row->>'newStatus',''),trim(v_row->>'reason'),v_created_at);
        insert into public.ledger_restore_items values (p_user_id,v_fingerprint,'repair',v_source_id,v_audit_id::text,now());
        end if;
      end if;
    end if;
    if v_source_id<>'' and not (v_source_id=any(v_seen_repair_sources)) then v_seen_repair_sources:=array_append(v_seen_repair_sources,v_source_id); end if;
    if jsonb_array_length(v_details)>100 then v_details:=v_details-100; v_details_truncated:=true; end if;
  end loop;

  v_result := jsonb_build_object(
    'dryRun',p_dry_run,'operationId',case when p_dry_run then null else p_operation_id end,
    'packageHash',v_client_hash,'payloadFingerprint',v_fingerprint,
    'added',v_added,'merged',v_merged,'conflicts',v_conflicts,'skipped',v_skipped,
    'details',v_details,'detailsTruncated',v_details_truncated
  );
  if not p_dry_run then
    update public.ledger_restore_operations set result=v_result where user_id=p_user_id and operation_id=p_operation_id;
  end if;
  return v_result;
end;
$$;

revoke all on function public.restore_ledger_backup(uuid,text,jsonb,boolean) from public, anon;
grant execute on function public.restore_ledger_backup(uuid,text,jsonb,boolean) to authenticated;

commit;
