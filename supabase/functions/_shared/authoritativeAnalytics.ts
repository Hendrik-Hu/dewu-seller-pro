const numberAt = (value: unknown, path: string, options: { min?: number; max?: number } = {}) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') throw new Error(`${path} is missing`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${path} is invalid`);
  if (options.min !== undefined && parsed < options.min) throw new Error(`${path} is below range`);
  if (options.max !== undefined && parsed > options.max) throw new Error(`${path} is above range`);
  return parsed;
};

export const extractSkuCandidates = (message: string) => {
  const normalized = message.toUpperCase();
  const explicit = [...normalized.matchAll(/(?:货号|SKU|款号)\s*[:：]?\s*([A-Z0-9_-]{2,32})/g)].map((match) => match[1]);
  const alphaNumeric = normalized.match(/\b(?=[A-Z0-9-]{3,32}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9-]+\b/g) || [];
  const separated = normalized.match(/\b(?=[A-Z0-9_-]{3,32}\b)(?=[A-Z0-9_-]*[-_])[A-Z0-9]+(?:[-_][A-Z0-9]+)+\b/g) || [];
  return [...new Set([...explicit, ...alphaNumeric, ...separated].map((value) => value.trim()).filter(Boolean))].slice(0, 8);
};

export const parseAuthoritativeAnalyticsSummary = (analytics: any) => {
  if (!analytics || typeof analytics !== 'object' || !analytics.dashboard || !analytics.monthly) {
    throw new Error('Authoritative analytics response is invalid');
  }
  const nonNegative = { min: 0 };
  const parsed = {
    variants: numberAt(analytics.dashboard.totalVariantCount, 'dashboard.totalVariantCount', nonNegative),
    skus: numberAt(analytics.dashboard.totalSkuCount, 'dashboard.totalSkuCount', nonNegative),
    stock: numberAt(analytics.dashboard.totalStock, 'dashboard.totalStock', nonNegative),
    value: numberAt(analytics.dashboard.totalInventoryValue, 'dashboard.totalInventoryValue', nonNegative),
    monthSales: numberAt(analytics.monthly.salesAmount, 'monthly.salesAmount', nonNegative),
    monthCostedSales: numberAt(analytics.monthly.costedSalesAmount, 'monthly.costedSalesAmount', nonNegative),
    monthKnownCost: numberAt(analytics.monthly.costAmount, 'monthly.costAmount', nonNegative),
    monthGrossProfit: numberAt(analytics.monthly.grossProfitAmount, 'monthly.grossProfitAmount'),
    monthInbound: numberAt(analytics.monthly.inboundCount, 'monthly.inboundCount', nonNegative),
    monthOutbound: numberAt(analytics.monthly.outboundCount, 'monthly.outboundCount', nonNegative),
    costCoverage: numberAt(analytics.monthly.costCoverageRate, 'monthly.costCoverageRate', { min: 0, max: 100 }),
    missingCostCount: numberAt(analytics.monthly.missingCostCount, 'monthly.missingCostCount', nonNegative),
  };
  for (const value of [parsed.variants, parsed.skus, parsed.stock, parsed.monthInbound, parsed.monthOutbound, parsed.missingCostCount]) {
    if (!Number.isInteger(value)) throw new Error('Authoritative analytics counts must be integers');
  }
  return parsed;
};
