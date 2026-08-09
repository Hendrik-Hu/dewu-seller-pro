begin;

drop policy if exists products_delete_own on public.products;
drop policy if exists activities_delete_own on public.activities;

revoke delete on table public.products from public, anon, authenticated;
revoke delete on table public.activities from public, anon, authenticated;

commit;
