import type { Product } from '../types.ts';

export interface ParsedInventoryAdjustment {
  newStock: number;
  newCost: number;
  targetStatus?: Product['status'];
  reason: string;
}

export const parseInventoryAdjustment = (
  product: Product,
  stockText: string,
  costText: string,
  reasonText: string,
  targetStatus?: Product['status'],
): ParsedInventoryAdjustment => {
  if (!stockText.trim()) throw new Error('请填写盘点后的库存数量');
  if (!costText.trim()) throw new Error('请填写校正后的平均成本');
  const newStock = Number(stockText);
  const newCost = Number(costText);
  const reason = reasonText.trim();
  if (!Number.isInteger(newStock) || newStock < 0 || newStock > 1_000_000) {
    throw new Error('库存应为 0 到 1000000 的整数');
  }
  if (!Number.isFinite(newCost) || newCost < 0 || newCost > 1_000_000) {
    throw new Error('平均成本应为 0 到 1000000 元');
  }
  if (reason.length < 4 || reason.length > 500) {
    throw new Error('请填写 4 到 500 个字符的核对原因');
  }
  const roundedCost = Math.round((newCost + Number.EPSILON) * 100) / 100;
  if (targetStatus && !(product.status === 'shipping' && targetStatus === 'instock')) {
    throw new Error('该状态变化不能通过盘点调整完成');
  }
  if (targetStatus === 'instock' && newStock <= 0) {
    throw new Error('运输中商品到仓时库存必须大于 0');
  }
  if (newStock === product.stock && roundedCost === product.price && (!targetStatus || targetStatus === product.status)) {
    throw new Error('库存和平均成本均未变化');
  }
  return {
    newStock,
    newCost: roundedCost,
    ...(targetStatus ? { targetStatus } : {}),
    reason,
  };
};
