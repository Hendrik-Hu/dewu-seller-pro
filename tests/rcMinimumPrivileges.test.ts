import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20260811040000_tighten_rc_minimum_privileges.sql', import.meta.url),
  'utf8',
);

test('RC database grants remain limited to the client capabilities the app uses', () => {
  assert.match(migration, /revoke truncate, references, trigger on table public\.fee_schemes from authenticated/i);
  for (const routine of [
    'guard_outbound_fee_snapshot_update',
    'guard_product_warehouse_reference',
    'guard_warehouse_insert',
    'normalize_fee_scheme_write',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${routine}\\(\\) from public, anon, authenticated`, 'i'));
  }
});

test('the deprecated SKU Edge surface cannot return to deployable source unnoticed', () => {
  assert.equal(existsSync(new URL('../supabase/functions/lookup-sku/index.ts', import.meta.url)), false);
});
