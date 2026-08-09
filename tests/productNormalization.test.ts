import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatProductSize,
  normalizeBrand,
  normalizeOptionalStoredCost,
  normalizeSize,
  normalizeSku,
  normalizeStoredCost,
  sameInventoryVariant,
} from '../lib/productNormalization.ts';

test('SKU is trimmed and normalized to uppercase', () => {
  assert.equal(normalizeSku(' dd1391-100 '), 'DD1391-100');
});

test('size is stored without duplicated Chinese suffix and formatted once', () => {
  assert.equal(normalizeSize(' 42码码 '), '42');
  assert.equal(normalizeSize('均码码'), '均码');
  assert.equal(formatProductSize('42码'), '42码');
  assert.equal(formatProductSize('均码码'), '均码');
});

test('blank and legacy placeholder brands use one Chinese fallback', () => {
  assert.equal(normalizeBrand(' Unknown '), '未知品牌');
  assert.equal(normalizeBrand(''), '未知品牌');
  assert.equal(normalizeBrand('Nike'), 'Nike');
});

test('invalid stored costs are kept out of inventory value calculations', () => {
  assert.equal(normalizeStoredCost(-1), 0);
  assert.equal(normalizeStoredCost('not-a-number'), 0);
  assert.equal(normalizeStoredCost('749.5'), 749.5);
  assert.equal(normalizeOptionalStoredCost(-1), undefined);
  assert.equal(normalizeOptionalStoredCost('not-a-number'), undefined);
  assert.equal(normalizeOptionalStoredCost(0), 0);
});

test('same SKU and size in different warehouses remain separate inventory variants', () => {
  assert.equal(
    sameInventoryVariant(
      { sku: 'dd1391', size: '46码', warehouse: '主仓' },
      { sku: 'DD1391', size: '46', warehouse: '主仓' },
    ),
    true,
  );
  assert.equal(
    sameInventoryVariant(
      { sku: 'DD1391', size: '46', warehouse: '主仓' },
      { sku: 'DD1391', size: '46', warehouse: '备用仓' },
    ),
    false,
  );
});
