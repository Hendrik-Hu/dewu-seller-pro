export type RepairTarget = 'products' | 'activities';
export type RepairProductStatus = 'instock' | 'shipping' | 'sold' | 'flaw';

export interface RepairValidationResult {
  error?: string;
  value?: number;
}

export const validateDataRepairInput = (
  target: RepairTarget,
  rawValue: string,
  reason: string,
  targetStatus?: RepairProductStatus | '',
): RepairValidationResult => {
  if (!rawValue.trim()) {
    return { error: target === 'products' ? '请填写核对后的实际库存' : '请填写核对后的流水数量' };
  }

  const value = Number(rawValue);
  const minimum = target === 'products' ? 0 : 1;
  if (!Number.isInteger(value) || value < minimum) {
    return { error: target === 'products' ? '库存必须是大于或等于 0 的整数' : '流水数量必须是大于 0 的整数' };
  }
  if (reason.trim().length < 3) return { error: '请填写核对依据' };

  if (target === 'products') {
    if (!targetStatus) return { error: '请选择修正后的商品状态' };
    if (value === 0 && targetStatus !== 'sold') return { error: '库存为 0 时状态必须为已售罄' };
    if (value > 0 && targetStatus === 'sold') return { error: '库存大于 0 时不能选择已售罄' };
  }

  return { value };
};
