const text = (value: unknown) => String(value || '').trim();

export const resolveAiInboundProductName = (
  skuValue: unknown,
  products: any[],
  _modelName: unknown,
) => {
  const sku = text(skuValue).toUpperCase();
  const names = products
    .filter((item) => text(item?.sku).toUpperCase() === sku)
    .map((item) => text(item?.name))
    .filter(Boolean);
  const descriptiveName = names
    .filter((name) => name.toUpperCase() !== sku)
    .sort((a, b) => b.length - a.length)[0];
  return descriptiveName || names[0] || sku;
};
