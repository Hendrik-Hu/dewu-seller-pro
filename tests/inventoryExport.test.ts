import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInventoryCsv } from '../lib/inventoryExport.ts';
import type { Product } from '../types.ts';

const product: Product = {
  id: '1',
  sku: 'DD1391',
  name: 'Dunk "Panda"',
  brand: 'Nike',
  size: '46',
  stock: 2,
  price: 749,
  warehouse: '主仓',
  location: 'A1',
  source: '得物',
  status: 'instock',
  imageUrl: '',
};

test('inventory export includes a UTF-8 BOM, Chinese headers, and escaped values', () => {
  const csv = buildInventoryCsv([product]);
  assert.ok(csv.startsWith('\uFEFF"货号","名称"'));
  assert.ok(csv.includes('"Dunk ""Panda"""'));
  assert.ok(csv.includes('"DD1391"'));
});

test('inventory export marks recoverable deleted rows', () => {
  const csv = buildInventoryCsv([{ ...product, deletedAt: '2026-08-09T00:00:00Z' }]);
  assert.ok(csv.endsWith('"是"'));
});

test('inventory export neutralizes spreadsheet formulas in seller-entered fields', () => {
  const csv = buildInventoryCsv([{ ...product, sku: '=HYPERLINK("https://example.com")', source: '  +1+1' }]);
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.com"")"'));
  assert.ok(csv.includes('"\'  +1+1"'));
});
