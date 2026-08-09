begin;

create or replace function public.delete_current_user_account(
  p_user_id uuid,
  p_confirmation text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_table record;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Unauthorized';
  end if;
  if p_confirmation is distinct from 'DELETE_MY_ACCOUNT' then
    raise exception 'Account deletion confirmation is invalid';
  end if;

  -- Settlement rows reference activities, so remove them before core ledger rows.
  delete from public.outbound_settlement_audit where user_id = p_user_id;

  -- Clear user-scoped operational tables which do not reference auth.users.
  for v_table in
    select distinct c.oid::regclass as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
    where c.relkind in ('r','p')
      and not exists (
        select 1 from pg_constraint fk
        where fk.conrelid = c.oid and fk.contype = 'f' and fk.confrelid = 'auth.users'::regclass
      )
  loop
    execute format('delete from %s where user_id = $1', v_table.table_name) using p_user_id;
  end loop;

  -- These existing core foreign keys are NO ACTION rather than CASCADE.
  delete from public.activities where user_id = p_user_id;
  delete from public.products where user_id = p_user_id;
  delete from public.warehouses where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;

  -- Remaining user-scoped tables use ON DELETE CASCADE.
  delete from auth.users where id = p_user_id;
  if not found then raise exception 'Account was not found'; end if;
  return true;
end;
$$;

revoke all on function public.delete_current_user_account(uuid,text) from public, anon;
grant execute on function public.delete_current_user_account(uuid,text) to authenticated;

commit;
