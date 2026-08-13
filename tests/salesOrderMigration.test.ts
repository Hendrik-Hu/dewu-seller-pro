import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../supabase/migrations/20260813010000_add_sales_order_lifecycle.sql', import.meta.url),
  'utf8',
);

test('sales order tables are read-only to clients and scoped by RLS', () => {
  assert.match(sql, /alter table public\.sales_orders enable row level security/i);
  assert.match(sql, /alter table public\.sales_order_events enable row level security/i);
  assert.match(sql, /using \(auth\.uid\(\) = user_id\)/i);
  assert.match(sql, /revoke all on table public\.sales_orders, public\.sales_order_events from public, anon, authenticated/i);
  assert.match(sql, /grant select on table public\.sales_orders, public\.sales_order_events to authenticated/i);
  assert.doesNotMatch(sql, /grant (insert|update|delete).*sales_orders/i);
});

test('order creation reserves inventory without writing an outbound activity', () => {
  const createFunction = sql.split('create or replace function public.transition_sales_order')[0];
  assert.match(createFunction, /v_new_stock := v_product\.stock - p_quantity/i);
  assert.match(createFunction, /status = case when v_new_stock = 0 then 'sold' else 'instock' end/i);
  assert.doesNotMatch(createFunction, /insert into public\.activities/i);
  assert.match(createFunction, /'status','pending_shipment'/i);
});

test('shipment writes one deterministic outbound activity without deducting inventory again', () => {
  const transitionFunction = sql.split('create or replace function public.transition_sales_order')[1];
  assert.match(transitionFunction, /v_activity_id := 'act-order-' \|\| replace\(v_order\.id::text,'-',''\)/i);
  assert.match(transitionFunction, /insert into public\.activities/i);
  assert.doesNotMatch(transitionFunction, /v_product\.stock - v_order\.quantity/i);
  assert.match(transitionFunction, /outbound_activity_id=case when p_action='ship'/i);
});

test('cancel and physical return restore inventory at most once', () => {
  assert.match(sql, /if v_order\.inventory_restored then raise exception 'Order inventory was already restored'/i);
  assert.match(sql, /v_new_stock := coalesce\(v_product\.stock,0\) \+ v_order\.quantity/i);
  assert.match(sql, /inventory_restored=case when p_action in \('cancel','confirm_return'\) then true/i);
  assert.match(sql, /'订单取消恢复'.*'退回收货恢复'/is);
});

test('operation ids bind payload fingerprints before any order mutation', () => {
  assert.match(sql, /sales-order-operation:/i);
  assert.match(sql, /payload_fingerprint is distinct from v_fingerprint/i);
  assert.match(sql, /return v_existing\.result \|\| jsonb_build_object\('replayed', true\)/i);
  assert.match(sql, /return v_existing\.result \|\| jsonb_build_object\('replayed',true\)/i);
});

test('open sales orders block recycle-bin deletion of reserved inventory', () => {
  assert.match(sql, /guard_open_sales_order_product_delete/i);
  assert.match(sql, /status not in \('canceled','returned','refunded'\)/i);
  assert.match(sql, /before update of deleted_at on public\.products/i);
});
