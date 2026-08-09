import { formatAiInventorySummaryAnswer } from './aiInventorySummary.ts';
import { calculateFeeQuote, roundMoney, type FeeSchemeLike } from './feeCalculations.ts';
import { calculateTargetUnitPrice, type TargetPricingKind } from './targetPricing.ts';

const executionPattern = /入库|进货|补货|新增|出库|卖了|卖掉|卖出|售出|发货/;
const globalSummaryPattern = /总结|分析|库存情况|经营情况|整体库存|库存总|多少库存|库存有多少|经营总结/;
const skuQueryPattern = /库存|多少|尺码|成本|仓库|查询|查一下|情况|有哪些/;
const targetPricingPattern = /(?:到手|净赚|净利润|净利率).*(?:卖多少|售价|最低)|(?:卖多少|售价|最低).*(?:到手|净赚|净利润|净利率)/;
const quotePricingPattern = /(?:卖|售价|单价).*(?:到手|净赚|净利润|净利率)|(?:到手|净赚|净利润|净利率).*(?:卖|售价|单价)/;

const numberOr = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const text = (value: unknown) => String(value || '').trim();

const normalizeSize = (value: unknown) => {
  const normalized = text(value).replace(/(?:\s*码)+$/u, '').trim();
  return normalized || '均码';
};

const moneyAfter = (message: string, labels: string[]) => {
  const escaped = labels.join('|');
  const match = message.match(new RegExp(`(?:${escaped})\\s*(?:为|是|要|目标)?\\s*[¥￥]?\\s*(\\d+(?:\\.\\d{1,2})?)`, 'i'));
  return match ? Number(match[1]) : undefined;
};

const parsePricingIntent = (message: string) => {
  const margin = message.match(/(?:目标)?净利率\s*(?:为|是|要|目标)?\s*(\d+(?:\.\d{1,2})?)\s*%?/);
  if (targetPricingPattern.test(message)) {
    if (margin) return { mode: 'target' as const, kind: 'netMargin' as TargetPricingKind, value: Number(margin[1]) };
    const profit = moneyAfter(message, ['净赚', '净利润']);
    if (profit != null) return { mode: 'target' as const, kind: 'netProfit' as TargetPricingKind, value: profit };
    const proceeds = moneyAfter(message, ['到手']);
    if (proceeds != null) return { mode: 'target' as const, kind: 'netProceeds' as TargetPricingKind, value: proceeds };
  }

  if (quotePricingPattern.test(message)) {
    const price = moneyAfter(message, ['卖', '售价', '单价']);
    if (price != null) return { mode: 'quote' as const, unitSalePrice: price };
  }
  return null;
};

const mapFeeScheme = (row: any): FeeSchemeLike => ({
  id: text(row.id),
  name: text(row.name),
  saleMode: text(row.sale_mode ?? row.saleMode),
  category: text(row.category),
  percentRate: numberOr(row.percent_rate ?? row.percentRate),
  percentMin: row.percent_min == null && row.percentMin == null ? undefined : numberOr(row.percent_min ?? row.percentMin),
  percentMax: row.percent_max == null && row.percentMax == null ? undefined : numberOr(row.percent_max ?? row.percentMax),
  percentageUnit: (row.percentage_unit ?? row.percentageUnit) === 'item' ? 'item' : 'transaction',
  fixedFee: numberOr(row.fixed_fee ?? row.fixedFee),
  fixedFeeUnit: (row.fixed_fee_unit ?? row.fixedFeeUnit) === 'item' ? 'item' : 'transaction',
  shippingFee: numberOr(row.shipping_fee ?? row.shippingFee),
  shippingFeeUnit: (row.shipping_fee_unit ?? row.shippingFeeUnit) === 'item' ? 'item' : 'transaction',
  otherFee: numberOr(row.other_fee ?? row.otherFee),
  otherFeeUnit: (row.other_fee_unit ?? row.otherFeeUnit) === 'item' ? 'item' : 'transaction',
  effectiveFrom: text(row.effective_from ?? row.effectiveFrom),
  isDefault: Boolean(row.is_default ?? row.isDefault),
  updatedAt: text(row.updated_at ?? row.updatedAt),
});

const buildInventoryVariants = (products: any[]) => {
  const variants = new Map<string, { sku: string; size: string; warehouse: string; stock: number; value: number }>();
  for (const item of products) {
    if (item?.status !== 'instock' || numberOr(item.stock) <= 0) continue;
    const sku = text(item.sku).toUpperCase();
    const size = normalizeSize(item.size);
    const warehouse = text(item.warehouse) || '未设置仓库';
    const key = `${sku}\u0000${size}\u0000${warehouse}`;
    const current = variants.get(key) || { sku, size, warehouse, stock: 0, value: 0 };
    const stock = Math.max(0, numberOr(item.stock));
    current.stock += stock;
    current.value += stock * Math.max(0, numberOr(item.price));
    variants.set(key, current);
  }
  return [...variants.values()].map((item) => ({ ...item, unitCost: roundMoney(item.value / item.stock) }));
};

const candidateLabel = (item: { size: string; warehouse: string; stock: number; unitCost: number }) =>
  `${item.size === '均码' ? '均码' : `${item.size}码`} / ${item.warehouse} / 库存${item.stock}件 / 成本¥${item.unitCost.toFixed(2)}`;

const buildDeterministicPricingAnswer = (message: string, context: any) => {
  const intent = parsePricingIntent(message);
  if (!intent) return null;

  let variants = buildInventoryVariants(Array.isArray(context?.relevantProducts) ? context.relevantProducts : []);
  if (variants.length === 0) return '没有找到这件商品的在售库存，请先确认货号。';

  const explicitSizes = [...new Set(variants.filter((item) => {
    const escaped = item.size.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return item.size === '均码' ? /均码/.test(message) : new RegExp(`(?:^|[^0-9.])${escaped}\\s*码(?:[^0-9.]|$)`).test(message);
  }).map((item) => item.size))];
  if (explicitSizes.length === 1) variants = variants.filter((item) => item.size === explicitSizes[0]);

  const explicitWarehouses = [...new Set(variants.filter((item) => message.includes(item.warehouse)).map((item) => item.warehouse))];
  if (explicitWarehouses.length === 1) variants = variants.filter((item) => item.warehouse === explicitWarehouses[0]);

  if (variants.length !== 1) {
    const candidates = variants.slice(0, 8).map(candidateLabel).join('；');
    return `需要先明确唯一库存变体（货号 + 尺码 + 仓库）。可选：${candidates}${variants.length > 8 ? '；还有更多候选' : ''}。请补充尺码和仓库后再问。`;
  }

  const variant = variants[0];
  const quantityMatch = message.match(/(\d+)\s*(?:双|件)/);
  const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > variant.stock) {
    return `数量必须是 1 到 ${variant.stock} 之间的整数。`;
  }

  const schemes = (Array.isArray(context?.feeSchemes) ? context.feeSchemes : []).map(mapFeeScheme);
  const explicitlyNamed = schemes.filter((scheme) => scheme.name && message.includes(scheme.name));
  const scheme = explicitlyNamed.length === 1 ? explicitlyNamed[0] : schemes.find((item) => item.isDefault);
  if (!scheme) return '当前没有可用的默认费用方案，无法可靠计算到手或净利润。请先在“我的 - 费用方案”配置并启用默认方案。';

  try {
    const result = intent.mode === 'target'
      ? calculateTargetUnitPrice({ kind: intent.kind, target: intent.value, unitCost: variant.unitCost, quantity, scheme })
      : { unitSalePrice: intent.unitSalePrice, quote: calculateFeeQuote({ unitSalePrice: intent.unitSalePrice, unitCost: variant.unitCost, quantity, scheme }) };
    if (!result) return `按费用方案“${scheme.name}”计算，单价 100 万元以内无法达到这个目标。`;
    const quote = result.quote;
    const prefix = intent.mode === 'target' ? `最低单件售价为 ¥${result.unitSalePrice.toFixed(2)}` : `单件售价 ¥${result.unitSalePrice.toFixed(2)}`;
    const marginText = quote.netMarginRate == null ? '—（成交额为 0）' : `${quote.netMarginRate.toFixed(1)}%`;
    return `${prefix}。成交额 ¥${quote.grossAmount.toFixed(2)}，预计费用 ¥${quote.totalFee!.toFixed(2)}，预计到手 ¥${quote.netProceeds!.toFixed(2)}，预计净利润 ¥${quote.netProfit!.toFixed(2)}，净利率 ${marginText}。` +
      `计算依据：${variant.sku} ${variant.size === '均码' ? '均码' : `${variant.size}码`}，${variant.warehouse}，成本 ¥${variant.unitCost.toFixed(2)} × ${quantity}，费用方案“${scheme.name}”（生效时间 ${scheme.effectiveFrom}）。` +
      (variant.unitCost === 0 ? ' 强提示：当前成本为 0，请先核对成本记录。' : '') +
      ' 结果仅为估算，不会生成或执行库存操作，实际费用以平台结算明细为准。';
  } catch (error) {
    return `暂时无法反算售价：${error instanceof Error ? error.message : '输入不符合计算规则'}。`;
  }
};

export const formatRelevantSkuInventoryAnswer = (products: any[]) => {
  const inStock = products.filter((item) => item?.status === 'instock' && numberOr(item.stock) > 0);
  const sku = text(products[0]?.sku).toUpperCase();
  if (inStock.length === 0) return `${sku || '该货号'} 当前没有在售库存。`;

  const bySize = new Map<string, { stock: number; value: number; warehouses: Map<string, number> }>();
  for (const item of inStock) {
    const size = text(item.size) || '均码';
    const stock = Math.max(0, numberOr(item.stock));
    const current = bySize.get(size) || { stock: 0, value: 0, warehouses: new Map<string, number>() };
    current.stock += stock;
    current.value += stock * Math.max(0, numberOr(item.price));
    const warehouse = text(item.warehouse) || '未设置仓库';
    current.warehouses.set(warehouse, (current.warehouses.get(warehouse) || 0) + stock);
    bySize.set(size, current);
  }

  const details = [...bySize.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'zh-CN', { numeric: true }))
    .map(([size, item]) => {
      const averageCost = item.stock > 0 ? Number((item.value / item.stock).toFixed(2)) : 0;
      const warehouses = [...item.warehouses.entries()].map(([name, stock]) => `${name} ${stock}件`).join('、');
      return `${size === '均码' ? '均码' : `${size}码`} ${item.stock}件，平均成本 ¥${averageCost}（${warehouses}）`;
    });
  const total = [...bySize.values()].reduce((sum, item) => sum + item.stock, 0);
  return `${sku} 当前在售库存 ${total} 件：${details.join('；')}。`;
};

export const buildDeterministicInventoryAnswer = (message: string, context: any) => {
  const normalized = text(message);
  if (!normalized || executionPattern.test(normalized)) return null;
  const pricingAnswer = buildDeterministicPricingAnswer(normalized, context);
  if (pricingAnswer) return pricingAnswer;
  if (globalSummaryPattern.test(normalized)) return formatAiInventorySummaryAnswer(context?.summary);
  const relevantProducts = Array.isArray(context?.relevantProducts) ? context.relevantProducts : [];
  if (relevantProducts.length > 0 && skuQueryPattern.test(normalized)) {
    return formatRelevantSkuInventoryAnswer(relevantProducts);
  }
  return null;
};
