begin;

create index if not exists products_user_sku_prefix_idx
  on public.products (user_id, (upper(btrim(sku))) text_pattern_ops, created_at desc, id desc)
  where deleted_at is null;

create or replace function public.suggest_inventory_skus(
  p_prefix text,
  p_limit integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_prefix text := upper(btrim(coalesce(p_prefix, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 5);
  v_pattern text;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(v_prefix) < 2 or char_length(v_prefix) > 32 or v_prefix !~ '^[A-Z0-9_-]+$' then
    raise exception 'SKU prefix is invalid';
  end if;

  v_pattern := replace(v_prefix, '_', '\_') || '%';
  with candidates as (
    select distinct on (upper(btrim(p.sku))) p.*
    from public.products p
    where p.user_id = v_user
      and p.deleted_at is null
      and upper(btrim(p.sku)) like v_pattern escape '\'
    order by upper(btrim(p.sku)), p.created_at desc, p.id desc
  ), limited as (
    select *
    from candidates
    order by case when upper(btrim(sku)) = v_prefix then 0 else 1 end,
      upper(btrim(sku)), created_at desc, id desc
    limit v_limit
  )
  select coalesce(jsonb_agg(to_jsonb(limited) - 'user_id'
    order by case when upper(btrim(sku)) = v_prefix then 0 else 1 end,
      upper(btrim(sku)), created_at desc, id desc), '[]'::jsonb)
  into v_result
  from limited;

  return v_result;
end;
$$;

create or replace function public.list_active_sku_variants(p_sku text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_sku text := upper(btrim(coalesce(p_sku, '')));
  v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if v_sku = '' or char_length(v_sku) > 32 or v_sku !~ '^[A-Z0-9_-]+$' then
    raise exception 'SKU is invalid';
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) - 'user_id'
    order by p.size, p.warehouse, p.created_at desc, p.id desc), '[]'::jsonb)
  into v_result
  from public.products p
  where p.user_id = v_user
    and p.deleted_at is null
    and p.status = 'instock'
    and p.stock > 0
    and upper(btrim(p.sku)) = v_sku;

  return v_result;
end;
$$;

revoke all on function public.suggest_inventory_skus(text,integer) from public, anon;
revoke all on function public.list_active_sku_variants(text) from public, anon;
grant execute on function public.suggest_inventory_skus(text,integer) to authenticated;
grant execute on function public.list_active_sku_variants(text) to authenticated;

commit;
