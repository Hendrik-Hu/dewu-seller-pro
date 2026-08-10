import type { InventoryAnalytics } from './inventoryMetrics';
import { normalizeBrand } from './productNormalization.ts';

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}返回结构无效`);
  }
  return value as Record<string, unknown>;
};

const requireFiniteNumber = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    throw new Error(`${label}不是有效数字`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}不是有效数字`);
  return parsed;
};

const requireText = (value: unknown, label: string) => {
  if (typeof value !== 'string') throw new Error(`${label}不是有效文本`);
  return value;
};

const requireArray = (value: unknown, label: string) => {
  if (!Array.isArray(value)) throw new Error(`${label}不是有效数组`);
  return value;
};

const numberFields = <T extends Record<string, number>>(source: unknown, shape: T, label: string): T => {
  const record = requireRecord(source, label);
  return Object.fromEntries(Object.keys(shape).map((key) => [
    key,
    requireFiniteNumber(record[key], `${label}.${key}`),
  ])) as T;
};

export const parseInventoryAnalytics = (data: unknown, shape: InventoryAnalytics): InventoryAnalytics => {
  const root = requireRecord(data, '经营摘要');
  const charts = requireRecord(root.charts, '经营摘要.charts');

  const parsed = {
    dataQuality: numberFields(root.dataQuality, shape.dataQuality, '经营摘要.dataQuality'),
    dashboard: numberFields(root.dashboard, shape.dashboard, '经营摘要.dashboard'),
    lifetime: numberFields(root.lifetime, shape.lifetime, '经营摘要.lifetime'),
    monthly: numberFields(root.monthly, shape.monthly, '经营摘要.monthly'),
    charts: {
      salesTrend: requireArray(charts.salesTrend, '经营摘要.charts.salesTrend').map((value, index) => {
        const item = requireRecord(value, `经营摘要.charts.salesTrend[${index}]`);
        return { name: requireText(item.name, `经营摘要.charts.salesTrend[${index}].name`), value: requireFiniteNumber(item.value, `经营摘要.charts.salesTrend[${index}].value`) };
      }),
      topBrands: requireArray(charts.topBrands, '经营摘要.charts.topBrands').map((value, index) => {
        const item = requireRecord(value, `经营摘要.charts.topBrands[${index}]`);
        return { name: normalizeBrand(requireText(item.name, `经营摘要.charts.topBrands[${index}].name`)), value: requireFiniteNumber(item.value, `经营摘要.charts.topBrands[${index}].value`) };
      }),
      topProducts: requireArray(charts.topProducts, '经营摘要.charts.topProducts').map((value, index) => {
        const item = requireRecord(value, `经营摘要.charts.topProducts[${index}]`);
        return {
          name: requireText(item.name, `经营摘要.charts.topProducts[${index}].name`),
          sku: requireText(item.sku, `经营摘要.charts.topProducts[${index}].sku`),
          sold: requireFiniteNumber(item.sold, `经营摘要.charts.topProducts[${index}].sold`),
        };
      }),
      topStockProducts: requireArray(charts.topStockProducts, '经营摘要.charts.topStockProducts').map((value, index) => {
        const item = requireRecord(value, `经营摘要.charts.topStockProducts[${index}]`);
        return {
          name: requireText(item.name, `经营摘要.charts.topStockProducts[${index}].name`),
          sku: requireText(item.sku, `经营摘要.charts.topStockProducts[${index}].sku`),
          stock: requireFiniteNumber(item.stock, `经营摘要.charts.topStockProducts[${index}].stock`),
        };
      }),
    },
    pendingProducts: [],
  };

  const nonNegative = [
    ...Object.entries(parsed.dataQuality),
    ...Object.entries(parsed.dashboard),
    ...Object.entries(parsed.lifetime),
    ...Object.entries(parsed.monthly).filter(([key]) => !['grossProfitAmount', 'grossMarginRate', 'estimatedNetProfitAmount', 'actualNetProfitAmount'].includes(key)),
  ];
  for (const [key, value] of nonNegative) {
    if (value < 0) throw new Error(`经营摘要.${key}不能为负数`);
  }
  for (const key of ['costCoverageRate', 'estimatedProfitCoverageRate', 'actualProfitCoverageRate', 'settlementCoverageRate'] as const) {
    const value = parsed.monthly[key];
    if (value < 0 || value > 100) throw new Error(`经营摘要.monthly.${key}必须在0到100之间`);
  }
  if (parsed.monthly.grossMarginRate > 100) throw new Error('经营摘要.monthly.grossMarginRate不能超过100');
  const integerValues = [
    ...Object.values(parsed.dataQuality),
    parsed.dashboard.pendingOrderCount,
    parsed.dashboard.totalSkuCount,
    parsed.dashboard.totalVariantCount,
    parsed.dashboard.todaySalesCount,
    parsed.dashboard.todayInboundCount,
    parsed.dashboard.totalStock,
    ...Object.values(parsed.lifetime),
    parsed.monthly.missingCostCount,
    parsed.monthly.costedOutboundCount,
    parsed.monthly.estimatedProfitCount,
    parsed.monthly.actualProfitCount,
    parsed.monthly.pendingSettlementCount,
    parsed.monthly.inboundCount,
    parsed.monthly.outboundCount,
  ];
  if (integerValues.some((value) => !Number.isInteger(value))) throw new Error('经营摘要离散数量必须为整数');
  for (const item of [...parsed.charts.salesTrend, ...parsed.charts.topBrands]) {
    if (item.value < 0) throw new Error('经营摘要图表数值不能为负数');
  }
  for (const item of parsed.charts.topProducts) {
    if (item.sold < 0) throw new Error('经营摘要热销数量不能为负数');
  }
  for (const item of parsed.charts.topStockProducts) {
    if (item.stock < 0) throw new Error('经营摘要库存数量不能为负数');
  }
  return parsed;
};

export const parseWarehouseSummary = (data: unknown) => {
  const root = requireRecord(data, '仓库摘要');
  const parsed = {
    totalCount: requireFiniteNumber(root.totalCount, '仓库摘要.totalCount'),
    totalValue: requireFiniteNumber(root.totalValue, '仓库摘要.totalValue'),
    warehouseCount: requireFiniteNumber(root.warehouseCount, '仓库摘要.warehouseCount'),
    warehouseValue: requireFiniteNumber(root.warehouseValue, '仓库摘要.warehouseValue'),
  };
  if (Object.values(parsed).some((value) => value < 0)) throw new Error('仓库摘要数值不能为负数');
  if (!Number.isInteger(parsed.totalCount) || !Number.isInteger(parsed.warehouseCount)) throw new Error('仓库摘要库存数量必须为整数');
  return parsed;
};

export const parseInventoryGroupSearchEnvelope = (data: unknown) => {
  const root = requireRecord(data, '库存搜索');
  const integers = ['groupCount', 'inventoryStock', 'rowCount', 'page', 'pageSize'] as const;
  const parsed = Object.fromEntries(integers.map((key) => {
    const value = requireFiniteNumber(root[key], `库存搜索.${key}`);
    if (!Number.isInteger(value) || value < (key === 'page' || key === 'pageSize' ? 1 : 0)) {
      throw new Error(`库存搜索.${key}不是有效非负整数`);
    }
    return [key, value];
  })) as Record<(typeof integers)[number], number>;
  return { ...parsed, products: requireArray(root.products, '库存搜索.products').map((row, index) => requireRecord(row, `库存搜索.products[${index}]`)) };
};
