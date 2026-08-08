export const normalizeSalePrice = (value: unknown): number => {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error('请输入实际出售价格。');
  }

  const salePrice = Number(value);
  if (!Number.isFinite(salePrice) || salePrice < 0) {
    throw new Error('实际出售价格必须是大于或等于 0 的数字。');
  }

  return Number(salePrice.toFixed(2));
};

export const normalizeOutboundQuantity = (value: unknown, availableStock: unknown): number => {
  const quantity = Number(value);
  const stock = Number(availableStock);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('出库数量必须是正整数。');
  }

  if (!Number.isFinite(stock) || stock < 0) {
    throw new Error('库存数据异常，请刷新后重试。');
  }

  if (quantity > stock) {
    throw new Error(`库存不足，当前仅剩 ${stock} 件。`);
  }

  return quantity;
};
