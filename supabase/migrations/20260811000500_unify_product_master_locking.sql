-- Serialize every batch that may update shared name/brand/image metadata by SKU
-- before the existing variant-level locks are acquired.
alter function public.batch_inbound_products(jsonb, uuid, text)
  rename to batch_inbound_products_pre_sku_lock_v12;

revoke all on function public.batch_inbound_products_pre_sku_lock_v12(jsonb, uuid, text)
  from public, anon, authenticated;

create or replace function public.batch_inbound_products(
  p_rows jsonb,
  p_user_id uuid,
  p_batch_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sku text;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if char_length(btrim(coalesce(p_batch_id, ''))) not between 8 and 120 then raise exception 'Inbound batch id is invalid'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Inbound rows must be an array'; end if;
  if jsonb_array_length(p_rows) not between 1 and 12 then raise exception 'Inbound rows must contain between 1 and 12 variants'; end if;
  if octet_length(convert_to(p_rows::text, 'UTF8')) > 1048576 then raise exception 'Inbound request exceeds 1 MB'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) row(value)
    where jsonb_typeof(row.value) is distinct from 'object'
      or exists (
        select 1 from jsonb_object_keys(case when jsonb_typeof(row.value) = 'object' then row.value else '{}'::jsonb end) key
        where key not in ('id','sku','size','warehouse','name','brand','image_url','location','source','quantity','cost','status')
      )
      or jsonb_typeof(row.value->'id') is distinct from 'string'
      or jsonb_typeof(row.value->'sku') is distinct from 'string'
      or jsonb_typeof(row.value->'size') is distinct from 'string'
      or jsonb_typeof(row.value->'warehouse') is distinct from 'string'
      or jsonb_typeof(row.value->'name') is distinct from 'string'
      or jsonb_typeof(row.value->'brand') is distinct from 'string'
      or jsonb_typeof(row.value->'image_url') is distinct from 'string'
      or jsonb_typeof(row.value->'location') is distinct from 'string'
      or jsonb_typeof(row.value->'source') is distinct from 'string'
      or jsonb_typeof(row.value->'quantity') is distinct from 'number'
      or jsonb_typeof(row.value->'cost') is distinct from 'number'
      or jsonb_typeof(row.value->'status') is distinct from 'string'
      or char_length(btrim(row.value->>'id')) not between 1 and 200
      or char_length(btrim(row.value->>'sku')) not between 1 and 120
      or char_length(btrim(row.value->>'size')) not between 1 and 40
      or char_length(btrim(row.value->>'warehouse')) not between 1 and 60
      or char_length(btrim(row.value->>'name')) not between 1 and 160
      or char_length(btrim(row.value->>'brand')) not between 1 and 80
      or char_length(btrim(row.value->>'location')) > 120
      or char_length(btrim(row.value->>'source')) > 240
      or char_length(btrim(row.value->>'image_url')) > 500
      or (btrim(row.value->>'image_url') <> '' and btrim(row.value->>'image_url') not like 'storage://product-images/' || p_user_id::text || '/%')
      or row.value->>'status' not in ('instock','shipping','sold','flaw')
  ) then raise exception 'Inbound row fields or lengths are invalid'; end if;

  -- A deterministic order prevents two multi-SKU batches from deadlocking.
  for v_sku in
    select distinct upper(trim(coalesce(value->>'sku', '')))
    from jsonb_array_elements(p_rows)
    order by 1
  loop
    if v_sku <> '' then
      perform pg_advisory_xact_lock(hashtextextended(
        'product-master:' || p_user_id::text || E'\x1f' || v_sku,
        0
      ));
    end if;
  end loop;

  return public.batch_inbound_products_pre_sku_lock_v12(p_rows, p_user_id, p_batch_id);
end;
$$;

revoke all on function public.batch_inbound_products(jsonb, uuid, text) from public, anon;
grant execute on function public.batch_inbound_products(jsonb, uuid, text) to authenticated;

alter table public.inbound_batches add column if not exists platform text;

create or replace function public.batch_inbound_products(
  p_rows jsonb,
  p_user_id uuid,
  p_batch_id text,
  p_platform text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_platform text := coalesce(nullif(btrim(p_platform), ''), '手动批量入库');
  v_bound_platform text;
begin
  if auth.uid() is distinct from p_user_id then raise exception 'Unauthorized'; end if;
  if char_length(v_platform) > 60 then raise exception 'Inbound platform is too long'; end if;

  v_result := public.batch_inbound_products(p_rows, p_user_id, p_batch_id);
  update public.inbound_batches set platform = v_platform
  where user_id = p_user_id and batch_id = p_batch_id and platform is null;
  select platform into v_bound_platform from public.inbound_batches
  where user_id = p_user_id and batch_id = p_batch_id;
  if v_bound_platform is distinct from v_platform then
    raise exception 'Inbound batch platform does not match the original request';
  end if;

  update public.activities activity
  set platform = v_platform
  where activity.user_id = p_user_id
    and activity.type = 'inbound'
    and activity.created_at = transaction_timestamp()
    and activity.platform = '手动批量入库'
    and exists (
      select 1 from jsonb_array_elements(p_rows) row_data
      where upper(btrim(coalesce(row_data->>'sku', ''))) = upper(btrim(coalesce(activity.sku, '')))
        and btrim(coalesce(row_data->>'size', '')) = btrim(coalesce(activity.size, ''))
        and btrim(coalesce(row_data->>'warehouse', '')) = btrim(coalesce(activity.warehouse, ''))
    );
  return v_result;
end;
$$;

revoke all on function public.batch_inbound_products(jsonb, uuid, text, text) from public, anon;
grant execute on function public.batch_inbound_products(jsonb, uuid, text, text) to authenticated;
