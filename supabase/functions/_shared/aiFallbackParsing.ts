const toNumber = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const stopWords = new Set([
  '入库', '出库', '进货', '补货', '新增', '卖了', '卖掉', '卖出', '售出', '发货', '把',
]);

const extractBrand = (normalized: string, escapedSku: string | undefined) => {
  if (!escapedSku) return '';
  const before = normalized.match(new RegExp(`([\\p{L}][\\p{L}\\p{N}&.-]{1,24})\\s+${escapedSku}`, 'iu'))?.[1];
  const after = normalized.match(new RegExp(`${escapedSku}\\s+([\\p{L}][\\p{L}\\p{N}&.-]{1,24})`, 'iu'))?.[1];
  return [before, after].find((candidate) => candidate && !stopWords.has(candidate)) || '';
};

const extractSemanticMoney = (normalized: string, labels: string[]) => {
  const semantic = normalized.match(new RegExp(`(?:${labels.join('|')})\\s*[:：]?\\s*(?:¥|￥)?\\s*(\\d+(?:\\.\\d+)?)`, 'i'))?.[1];
  if (semantic !== undefined) return { value: toNumber(semantic), explicit: true };
  const currency = normalized.match(/(?:¥|￥)\s*(\d+(?:\.\d+)?)/)?.[1];
  if (currency !== undefined) return { value: toNumber(currency), explicit: true };
  return { value: 0, explicit: false };
};

export const parseBasicInventoryCommand = (message: string) => {
  const normalized = message.replace(/\s+/g, ' ').trim();
  const sku = normalized.match(/[A-Z0-9]{2,8}-\d{3}|[A-Z]{1,3}\d{3,6}/i)?.[0]?.toUpperCase() || '';
  const escapedSku = sku ? sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : undefined;
  const size = normalized.match(/(?:尺码|size)?\s*[:：]?\s*(\d{2}(?:\.\d)?|均码)\s*(?:码|size)/i)?.[1] || '';
  const quantity = toNumber(normalized.match(/(\d+)\s*(?:双|件|个|只|条|台)/)?.[1]) || 1;

  return {
    normalized,
    sku,
    brand: extractBrand(normalized, escapedSku),
    size,
    quantity,
    inboundCost: extractSemanticMoney(normalized, ['成本', '进价', '采购价']),
    outboundPrice: extractSemanticMoney(normalized, ['售价', '卖价', '实收', '成交价']),
  };
};
