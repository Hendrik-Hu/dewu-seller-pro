export interface FeeSchemeLike {
  id: string;
  name: string;
  saleMode: string;
  category: string;
  percentRate: number;
  percentMin?: number;
  percentMax?: number;
  percentageUnit: 'transaction' | 'item';
  fixedFee: number;
  fixedFeeUnit: 'transaction' | 'item';
  shippingFee: number;
  shippingFeeUnit: 'transaction' | 'item';
  otherFee: number;
  otherFeeUnit: 'transaction' | 'item';
  effectiveFrom: string;
  isDefault: boolean;
  updatedAt: string;
}

export interface FeeQuoteLike {
  known: boolean;
  grossAmount: number;
  costAmount: number;
  percentageCalculated?: number;
  percentageApplied?: number;
  percentageUnit?: 'transaction' | 'item';
  percentageUnitCount?: number;
  fixedFee?: number;
  fixedFeeUnit?: 'transaction' | 'item';
  fixedFeeMultiplier?: number;
  shippingFee?: number;
  shippingFeeUnit?: 'transaction' | 'item';
  shippingFeeMultiplier?: number;
  otherFee?: number;
  otherFeeUnit?: 'transaction' | 'item';
  otherFeeMultiplier?: number;
  calculatedFee?: number;
  manualFeeOverride?: number;
  totalFee?: number;
  netProceeds?: number;
  netProfit?: number;
  netMarginRate?: number;
  breakEvenUnitPrice?: number;
}

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const requireNonnegativeMoney = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) throw new Error(`${label}必须是 0 到 100 万之间的数字`);
  return roundMoney(value);
};

export const validateFeeScheme = (scheme: Omit<FeeSchemeLike, 'id' | 'updatedAt'>) => {
  if (!scheme.name.trim()) throw new Error('请输入费用方案名称');
  if (!Number.isFinite(scheme.percentRate) || scheme.percentRate < 0 || scheme.percentRate > 100) throw new Error('比例费率必须在 0% 到 100% 之间');
  const percentMin = scheme.percentMin == null ? undefined : requireNonnegativeMoney(scheme.percentMin, '比例费最低费用');
  const percentMax = scheme.percentMax == null ? undefined : requireNonnegativeMoney(scheme.percentMax, '比例费最高费用');
  if (percentMin != null && percentMax != null && percentMin > percentMax) throw new Error('比例费最低费用不能高于最高费用');
  requireNonnegativeMoney(scheme.fixedFee, '固定费');
  requireNonnegativeMoney(scheme.shippingFee, '运费');
  requireNonnegativeMoney(scheme.otherFee, '其他费用');
  if (!Number.isFinite(new Date(scheme.effectiveFrom).getTime())) throw new Error('生效时间无效');
};

export const calculateSchemeFee = (unitSalePrice: number, quantity: number, scheme: FeeSchemeLike) => {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('数量必须是正整数');
  const unitPrice = requireNonnegativeMoney(unitSalePrice, '售价');
  const percentageMultiplier = scheme.percentageUnit === 'item' ? quantity : 1;
  const percentageBase = scheme.percentageUnit === 'item' ? unitPrice : roundMoney(unitPrice * quantity);
  const calculatedPerUnit = roundMoney(percentageBase * scheme.percentRate / 100);
  let appliedPerUnit = calculatedPerUnit;
  if (scheme.percentMin != null) appliedPerUnit = Math.max(appliedPerUnit, scheme.percentMin);
  if (scheme.percentMax != null) appliedPerUnit = Math.min(appliedPerUnit, scheme.percentMax);
  const calculated = roundMoney(calculatedPerUnit * percentageMultiplier);
  const applied = roundMoney(roundMoney(appliedPerUnit) * percentageMultiplier);
  const fixedFeeMultiplier = scheme.fixedFeeUnit === 'item' ? quantity : 1;
  const shippingFeeMultiplier = scheme.shippingFeeUnit === 'item' ? quantity : 1;
  const otherFeeMultiplier = scheme.otherFeeUnit === 'item' ? quantity : 1;
  const fixedFee = roundMoney(scheme.fixedFee * fixedFeeMultiplier);
  const shippingFee = roundMoney(scheme.shippingFee * shippingFeeMultiplier);
  const otherFee = roundMoney(scheme.otherFee * otherFeeMultiplier);
  const total = roundMoney(applied + fixedFee + shippingFee + otherFee);
  return {
    calculated, applied, fixedFee, shippingFee, otherFee, percentageMultiplier,
    fixedFeeMultiplier, shippingFeeMultiplier, otherFeeMultiplier, total,
  };
};

export const calculateBreakEvenUnitPrice = (unitCost: number, quantity: number, scheme: FeeSchemeLike, manualFeeOverride?: number) => {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('数量必须是正整数');
  const costAmount = roundMoney(requireNonnegativeMoney(unitCost, '成本') * quantity);
  if (manualFeeOverride != null) {
    const requiredTotal = costAmount + requireNonnegativeMoney(manualFeeOverride, '手动费用');
    return Math.ceil((requiredTotal / quantity) * 100 - Number.EPSILON) / 100;
  }

  const isProfitableAtCents = (unitPriceCents: number) => {
    const unitPrice = unitPriceCents / 100;
    return roundMoney(unitPrice * quantity - calculateSchemeFee(unitPrice, quantity, scheme).total - costAmount) >= 0;
  };
  let highCents = Math.max(1, Math.ceil((costAmount / quantity) * 100));
  const maximumUnitPriceCents = 100_000_000;
  while (!isProfitableAtCents(highCents) && highCents < maximumUnitPriceCents) {
    highCents = Math.min(maximumUnitPriceCents, highCents * 2);
  }
  if (!isProfitableAtCents(highCents)) return undefined;
  let lowCents = -1;
  while (highCents - lowCents > 1) {
    const middleCents = Math.floor((lowCents + highCents) / 2);
    if (isProfitableAtCents(middleCents)) highCents = middleCents; else lowCents = middleCents;
  }
  return highCents / 100;
};

export const calculateFeeQuote = ({
  unitSalePrice,
  unitCost,
  quantity,
  scheme,
  manualFeeOverride,
}: {
  unitSalePrice: number;
  unitCost: number;
  quantity: number;
  scheme?: FeeSchemeLike;
  manualFeeOverride?: number;
}): FeeQuoteLike => {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('数量必须是正整数');
  const grossAmount = roundMoney(requireNonnegativeMoney(unitSalePrice, '售价') * quantity);
  const costAmount = roundMoney(requireNonnegativeMoney(unitCost, '成本') * quantity);
  if (!scheme && manualFeeOverride == null) return { known: false, grossAmount, costAmount };

  const schemeFee = scheme ? calculateSchemeFee(unitSalePrice, quantity, scheme) : {
    calculated: 0, applied: 0, fixedFee: 0, shippingFee: 0, otherFee: 0,
    percentageMultiplier: 0, fixedFeeMultiplier: 0, shippingFeeMultiplier: 0, otherFeeMultiplier: 0, total: 0,
  };
  const override = manualFeeOverride == null ? undefined : requireNonnegativeMoney(manualFeeOverride, '手动费用');
  const totalFee = override ?? schemeFee.total;
  const netProceeds = roundMoney(grossAmount - totalFee);
  const netProfit = roundMoney(netProceeds - costAmount);
  return {
    known: true,
    grossAmount,
    costAmount,
    percentageCalculated: schemeFee.calculated,
    percentageApplied: schemeFee.applied,
    percentageUnit: scheme?.percentageUnit,
    percentageUnitCount: schemeFee.percentageMultiplier,
    fixedFee: schemeFee.fixedFee,
    fixedFeeUnit: scheme?.fixedFeeUnit,
    fixedFeeMultiplier: schemeFee.fixedFeeMultiplier,
    shippingFee: schemeFee.shippingFee,
    shippingFeeUnit: scheme?.shippingFeeUnit,
    shippingFeeMultiplier: schemeFee.shippingFeeMultiplier,
    otherFee: schemeFee.otherFee,
    otherFeeUnit: scheme?.otherFeeUnit,
    otherFeeMultiplier: schemeFee.otherFeeMultiplier,
    calculatedFee: schemeFee.total,
    manualFeeOverride: override,
    totalFee,
    netProceeds,
    netProfit,
    netMarginRate: grossAmount > 0 ? netProfit / grossAmount * 100 : undefined,
    breakEvenUnitPrice: scheme
      ? calculateBreakEvenUnitPrice(unitCost, quantity, scheme, override)
      : Math.ceil(((costAmount + totalFee) / quantity) * 100 - Number.EPSILON) / 100,
  };
};
