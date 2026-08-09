import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateTargetUnitPrice, targetPricingSatisfied, type TargetPricingInput } from '../lib/targetPricing.ts';
import type { FeeScheme } from '../types.ts';

const scheme: FeeScheme = {
  id: 'fee-1', name: '普通出售', saleMode: '普通出售', category: '鞋类', percentRate: 5,
  percentMin: 3, percentMax: 20, fixedFee: 2, shippingFee: 8, otherFee: 1,
  percentageUnit: 'transaction', fixedFeeUnit: 'transaction', shippingFeeUnit: 'transaction', otherFeeUnit: 'transaction',
  effectiveFrom: '2026-08-10T00:00:00.000Z', isDefault: true, updatedAt: '2026-08-10T00:00:00.000Z',
};

const assertFirstSatisfyingCent = (input: TargetPricingInput) => {
  const result = calculateTargetUnitPrice(input);
  assert.notEqual(result, undefined);
  assert.equal(targetPricingSatisfied(input, result!.unitSalePrice), true);
  if (result!.unitSalePrice > 0) {
    assert.equal(targetPricingSatisfied(input, Number((result!.unitSalePrice - 0.01).toFixed(2))), false);
  }
  return result!;
};

test('reverse prices net proceeds, net profit and net margin to the first cent', () => {
  for (const input of [
    { kind: 'netProceeds' as const, target: 300, unitCost: 73.27, quantity: 3, scheme },
    { kind: 'netProfit' as const, target: 80, unitCost: 73.27, quantity: 3, scheme },
    { kind: 'netMargin' as const, target: 20, unitCost: 73.27, quantity: 3, scheme },
  ]) assertFirstSatisfyingCent(input);
});

test('reverse pricing preserves item-based caps and fixed costs', () => {
  assertFirstSatisfyingCent({
    kind: 'netProfit', target: 20, unitCost: 40, quantity: 3,
    scheme: { ...scheme, percentageUnit: 'item', percentMax: 4.15, fixedFeeUnit: 'item', shippingFeeUnit: 'item' },
  });
});

test('manual fee override works without a scheme and preserves zero targets', () => {
  const result = assertFirstSatisfyingCent({ kind: 'netProfit', target: 0, unitCost: 73.27, quantity: 3, manualFeeOverride: 7.30 });
  assert.equal(result.unitSalePrice, 75.71);
});

test('a zero target with zero cost and fee returns zero price without inventing a margin', () => {
  const result = calculateTargetUnitPrice({ kind: 'netProfit', target: 0, unitCost: 0, quantity: 1, manualFeeOverride: 0 });
  assert.equal(result?.unitSalePrice, 0);
  assert.equal(result?.quote.netProfit, 0);
  assert.equal(result?.quote.netMarginRate, undefined);
});

test('impossible and unknown fee cases are explicit', () => {
  const impossible = { ...scheme, percentRate: 100, percentMin: undefined, percentMax: undefined, fixedFee: 1, shippingFee: 0, otherFee: 0 };
  assert.equal(calculateTargetUnitPrice({ kind: 'netProfit', target: 0, unitCost: 10, quantity: 1, scheme: impossible }), undefined);
  assert.throws(() => calculateTargetUnitPrice({ kind: 'netProfit', target: 10, unitCost: 10, quantity: 1 }), /费用方案/);
});

test('invalid negative and out-of-range targets are rejected', () => {
  assert.throws(() => calculateTargetUnitPrice({ kind: 'netProfit', target: -0.01, unitCost: 0, quantity: 1, scheme }), /目标值/);
  assert.throws(() => calculateTargetUnitPrice({ kind: 'netMargin', target: 100.01, unitCost: 0, quantity: 1, scheme }), /净利率/);
});
