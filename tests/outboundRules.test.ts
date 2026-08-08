import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOutboundQuantity, normalizeSalePrice } from '../lib/outboundRules.ts';

test('sale price must be explicit and never falls back to cost', () => {
  assert.throws(() => normalizeSalePrice(''), /请输入实际出售价格/);
  assert.throws(() => normalizeSalePrice(undefined), /请输入实际出售价格/);
  assert.equal(normalizeSalePrice(0), 0);
  assert.equal(normalizeSalePrice('899.129'), 899.13);
});

test('sale price rejects negative and invalid values', () => {
  assert.throws(() => normalizeSalePrice(-1), /大于或等于 0/);
  assert.throws(() => normalizeSalePrice('abc'), /大于或等于 0/);
});

test('outbound quantity must be a positive integer within stock', () => {
  assert.equal(normalizeOutboundQuantity('2', 3), 2);
  assert.throws(() => normalizeOutboundQuantity(0, 3), /正整数/);
  assert.throws(() => normalizeOutboundQuantity(1.5, 3), /正整数/);
  assert.throws(() => normalizeOutboundQuantity(4, 3), /库存不足/);
});
