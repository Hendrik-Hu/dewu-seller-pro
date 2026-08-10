import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const modalSource = readFileSync(new URL('../components/AddProductModal.tsx', import.meta.url), 'utf8');
const edgeSource = readFileSync(new URL('../supabase/functions/lookup-sku/index.ts', import.meta.url), 'utf8');

test('inbound SKU suggestions only use the signed-in seller inventory', () => {
  assert.match(modalSource, /existingProducts/);
  assert.match(modalSource, /\.slice\(0, 5\)/);
  assert.match(modalSource, /仅联想当前账号库存中已有的货号/);
  assert.doesNotMatch(modalSource, /functions\.invoke\('lookup-sku'/);
});

test('deprecated SKU lookup never returns mock or inferred product data', () => {
  assert.match(edgeSource, /deprecated:\s*true/);
  assert.match(edgeSource, /不会返回推测或演示数据/);
  assert.doesNotMatch(edgeSource, /MOCK_DB|stockx\.com|price:\s*\d+/i);
});
