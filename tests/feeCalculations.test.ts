import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateBreakEvenUnitPrice, calculateFeeQuote, calculateSchemeFee, validateFeeScheme } from '../lib/feeCalculations.ts';
import type { FeeScheme } from '../types.ts';

const scheme: FeeScheme = {
  id: 'fee-1', name: '普通出售', saleMode: '普通出售', category: '鞋类', percentRate: 5,
  percentMin: 3, percentMax: 20, fixedFee: 2, shippingFee: 8, otherFee: 1,
  percentageUnit: 'transaction', fixedFeeUnit: 'transaction', shippingFeeUnit: 'transaction', otherFeeUnit: 'transaction',
  effectiveFrom: '2026-08-10T00:00:00.000Z', isDefault: true, updatedAt: '2026-08-10T00:00:00.000Z',
};

test('fee quote applies percentage, fixed costs and order quantity with cent rounding', () => {
  const quote = calculateFeeQuote({ unitSalePrice: 100.01, unitCost: 70, quantity: 2, scheme });
  assert.equal(quote.grossAmount, 200.02);
  assert.equal(quote.percentageCalculated, 10);
  assert.equal(quote.totalFee, 21);
  assert.equal(quote.netProceeds, 179.02);
  assert.equal(quote.netProfit, 39.02);
});

test('percentage minimum and maximum caps are applied before fixed fees', () => {
  assert.deepEqual(calculateSchemeFee(10, 1, scheme), { calculated: 0.5, applied: 3, fixedFee: 2, shippingFee: 8, otherFee: 1, percentageMultiplier: 1, fixedFeeMultiplier: 1, shippingFeeMultiplier: 1, otherFeeMultiplier: 1, total: 14 });
  assert.deepEqual(calculateSchemeFee(1000, 1, scheme), { calculated: 50, applied: 20, fixedFee: 2, shippingFee: 8, otherFee: 1, percentageMultiplier: 1, fixedFeeMultiplier: 1, shippingFeeMultiplier: 1, otherFeeMultiplier: 1, total: 31 });
});

test('item-based caps and fixed fees multiply transparently for multi-item outbound', () => {
  const itemScheme = { ...scheme, percentageUnit: 'item' as const, fixedFeeUnit: 'item' as const, shippingFeeUnit: 'item' as const, otherFeeUnit: 'item' as const };
  const fee = calculateSchemeFee(10, 2, itemScheme);
  assert.equal(fee.applied, 6);
  assert.equal(fee.fixedFeeMultiplier, 2);
  assert.equal(fee.total, 28);
});

test('manual total fee override and zero-price sale remain explicit', () => {
  const quote = calculateFeeQuote({ unitSalePrice: 0, unitCost: 10, quantity: 2, scheme, manualFeeOverride: 0 });
  assert.equal(quote.totalFee, 0);
  assert.equal(quote.netProceeds, 0);
  assert.equal(quote.netProfit, -20);
  assert.equal(quote.netMarginRate, undefined);
  assert.equal(quote.breakEvenUnitPrice, 10);
});

test('missing scheme and missing override keep fees and net profit unknown', () => {
  assert.deepEqual(calculateFeeQuote({ unitSalePrice: 100, unitCost: 60, quantity: 1 }), { known: false, grossAmount: 100, costAmount: 60 });
});

test('manual-only break-even rounds upward to the first profitable cent', () => {
  const quote = calculateFeeQuote({ unitSalePrice: 75.71, unitCost: 73.27, quantity: 3, manualFeeOverride: 7.30 });
  assert.equal(quote.breakEvenUnitPrice, 75.71);
  assert.ok(calculateFeeQuote({ unitSalePrice: 75.70, unitCost: 73.27, quantity: 3, manualFeeOverride: 7.30 }).netProfit! < 0);
  assert.ok(quote.netProfit! >= 0);
});

test('break-even respects percentage caps and detects an impossible 100 percent fee', () => {
  assert.equal(calculateBreakEvenUnitPrice(100, 1, scheme), 116.84);
  const impossible = { ...scheme, percentRate: 100, percentMin: undefined, percentMax: undefined, fixedFee: 1, shippingFee: 0, otherFee: 0 };
  assert.equal(calculateBreakEvenUnitPrice(100, 1, impossible), undefined);
});

test('break-even is the first profitable cent for multi-item and manual fee cases', () => {
  const cases = [
    { quantity: 3, unitCost: 73.27, scheme: { ...scheme, percentageUnit: 'item' as const, percentMax: 4.15 } },
    { quantity: 3, unitCost: 73.27, scheme, manualFeeOverride: 7.30 },
  ];
  for (const item of cases) {
    const breakEven = calculateBreakEvenUnitPrice(item.unitCost, item.quantity, item.scheme, item.manualFeeOverride);
    assert.notEqual(breakEven, undefined);
    const atBreakEven = calculateFeeQuote({ unitSalePrice: breakEven!, unitCost: item.unitCost, quantity: item.quantity, scheme: item.scheme, manualFeeOverride: item.manualFeeOverride });
    assert.ok(atBreakEven.netProfit! >= 0);
    if (breakEven! > 0) {
      const below = calculateFeeQuote({ unitSalePrice: roundToCents(breakEven! - 0.01), unitCost: item.unitCost, quantity: item.quantity, scheme: item.scheme, manualFeeOverride: item.manualFeeOverride });
      assert.ok(below.netProfit! < 0);
    }
  }
});

const roundToCents = (value: number) => Math.round(value * 100) / 100;

test('scheme validation rejects invalid bounds and money values', () => {
  assert.throws(() => validateFeeScheme({ ...scheme, percentMin: 30, percentMax: 20 }), /最低费用/);
  assert.throws(() => validateFeeScheme({ ...scheme, fixedFee: -1 }), /固定费/);
  assert.throws(() => validateFeeScheme({ ...scheme, percentRate: 101 }), /比例费率/);
  assert.throws(() => validateFeeScheme({ ...scheme, shippingFee: 1_000_000.01 }), /100 万/);
});
