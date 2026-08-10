import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const modalSource = readFileSync(new URL('../components/AddProductModal.tsx', import.meta.url), 'utf8');
const legacyFunction = new URL('../supabase/functions/lookup-sku/index.ts', import.meta.url);

test('inbound SKU suggestions only use the signed-in seller inventory', () => {
  assert.match(modalSource, /suggestInventorySkus\(userId, prefix, 5\)/);
  assert.match(modalSource, /latestSuggestionRequest/);
  assert.match(modalSource, /仅联想当前账号库存中已有的货号/);
  assert.doesNotMatch(modalSource, /existingProducts/);
  assert.doesNotMatch(modalSource, /functions\.invoke\('lookup-sku'/);
});

test('deprecated SKU lookup is absent from both client and deployable functions', () => {
  assert.equal(existsSync(legacyFunction), false);
  assert.doesNotMatch(modalSource, /functions\.invoke\('lookup-sku'/);
});
