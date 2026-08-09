import { calculateFeeQuote, type FeeQuoteLike, type FeeSchemeLike } from './feeCalculations.ts';

export type TargetPricingKind = 'netProceeds' | 'netProfit' | 'netMargin';

export interface TargetPricingInput {
  kind: TargetPricingKind;
  target: number;
  unitCost: number;
  quantity: number;
  scheme?: FeeSchemeLike;
  manualFeeOverride?: number;
}

export interface TargetPricingResult {
  unitSalePrice: number;
  quote: FeeQuoteLike;
}

const MAX_UNIT_PRICE_CENTS = 100_000_000;

const validateTarget = (kind: TargetPricingKind, target: number) => {
  if (!Number.isFinite(target) || target < 0) throw new Error('目标值必须是大于或等于 0 的数字');
  if (kind === 'netMargin' && target > 100) throw new Error('目标净利率必须在 0% 到 100% 之间');
  if (kind !== 'netMargin' && target > 100_000_000) throw new Error('目标金额不能超过 1 亿元');
};

const satisfiesTarget = (kind: TargetPricingKind, target: number, quote: FeeQuoteLike) => {
  if (!quote.known) return false;
  if (kind === 'netProceeds') return (quote.netProceeds ?? Number.NEGATIVE_INFINITY) >= target;
  if (kind === 'netProfit') return (quote.netProfit ?? Number.NEGATIVE_INFINITY) >= target;
  return quote.grossAmount > 0 && (quote.netMarginRate ?? Number.NEGATIVE_INFINITY) >= target;
};

export const calculateTargetUnitPrice = (input: TargetPricingInput): TargetPricingResult | undefined => {
  validateTarget(input.kind, input.target);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error('数量必须是正整数');
  if (!input.scheme && input.manualFeeOverride == null) throw new Error('请先选择费用方案，或填写本次手动平台总费用');

  const quoteAt = (cents: number) => calculateFeeQuote({
    unitSalePrice: cents / 100,
    unitCost: input.unitCost,
    quantity: input.quantity,
    scheme: input.scheme,
    manualFeeOverride: input.manualFeeOverride,
  });

  if (!satisfiesTarget(input.kind, input.target, quoteAt(MAX_UNIT_PRICE_CENTS))) return undefined;

  let low = -1;
  let high = MAX_UNIT_PRICE_CENTS;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (satisfiesTarget(input.kind, input.target, quoteAt(middle))) high = middle;
    else low = middle;
  }

  return { unitSalePrice: high / 100, quote: quoteAt(high) };
};

export const targetPricingSatisfied = (input: TargetPricingInput, unitSalePrice: number) =>
  satisfiesTarget(input.kind, input.target, calculateFeeQuote({
    unitSalePrice,
    unitCost: input.unitCost,
    quantity: input.quantity,
    scheme: input.scheme,
    manualFeeOverride: input.manualFeeOverride,
  }));
