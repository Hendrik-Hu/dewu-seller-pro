import assert from 'node:assert/strict';
import test from 'node:test';
import type { Activity } from '../types.ts';
import { calculateSettlementPreview, normalizeSettlementFee } from '../lib/settlementCalculations.ts';

const outbound = (overrides: Partial<Activity> = {}): Activity => ({
  id: 'out-1', type: 'outbound', productName: '鞋', time: '', sku: 'SKU1', size: '42',
  price: 100, cost: 60, count: 2, imageUrl: '', createdAt: '2026-08-10T10:00:00Z', ...overrides,
});

test('zero actual fee is valid and profit uses frozen outbound cost', () => {
  const result = calculateSettlementPreview(outbound({ estimatedPlatformFee: 20, estimatedNetProfit: 60 }), normalizeSettlementFee('0'));
  assert.deepEqual(result, { grossAmount: 200, actualPlatformFee: 0, actualNetProceeds: 200, actualNetProfit: 80, feeVariance: -20, profitVariance: 20 });
});

test('missing frozen cost keeps actual net profit unknown', () => {
  const result = calculateSettlementPreview(outbound({ cost: undefined }), 10);
  assert.equal(result.actualNetProceeds, 190);
  assert.equal(result.actualNetProfit, undefined);
});

test('settlement rejects blank and negative fees but allows negative take-home', () => {
  assert.throws(() => normalizeSettlementFee(''), /请输入/);
  assert.throws(() => normalizeSettlementFee(-1), /必须/);
  const result = calculateSettlementPreview(outbound(), 220);
  assert.equal(result.actualNetProceeds, -20);
  assert.equal(result.actualNetProfit, -140);
});
