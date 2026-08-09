import type { Activity } from '../types';
import { getActivityGrossAmount, getActivityQuantity, hasRecordedActivityCost } from './inventoryMetrics.ts';

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const normalizeSettlementFee = (value: string | number) => {
  if (String(value).trim() === '') throw new Error('请输入实际平台总费用');
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) throw new Error('实际平台总费用必须在 0 到 100 万之间');
  return roundMoney(amount);
};

export const calculateSettlementPreview = (activity: Activity, platformFee: number) => {
  if (activity.type !== 'outbound') throw new Error('只有出库流水可以补录结算');
  const quantity = getActivityQuantity(activity);
  if (quantity <= 0) throw new Error('异常出库数量不能补录结算');
  const grossAmount = roundMoney(getActivityGrossAmount(activity));
  const actualNetProceeds = roundMoney(grossAmount - platformFee);
  const actualNetProfit = hasRecordedActivityCost(activity)
    ? roundMoney(actualNetProceeds - Number(activity.cost) * quantity)
    : undefined;
  return {
    grossAmount,
    actualPlatformFee: platformFee,
    actualNetProceeds,
    actualNetProfit,
    feeVariance: activity.estimatedPlatformFee == null ? undefined : roundMoney(platformFee - activity.estimatedPlatformFee),
    profitVariance: activity.estimatedNetProfit == null || actualNetProfit == null
      ? undefined
      : roundMoney(actualNetProfit - activity.estimatedNetProfit),
  };
};
