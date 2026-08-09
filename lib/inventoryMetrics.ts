import type { Activity, Product } from '../types';

const isValidDate = (value?: string) => {
  if (!value) return false;
  return !Number.isNaN(new Date(value).getTime());
};

const getActivityDate = (activity: Activity) => {
  const value = activity.created_at || activity.createdAt;
  return isValidDate(value) ? new Date(value as string) : null;
};

export const getActivityQuantity = (activity: Activity) => {
  if (activity.count === undefined || activity.count === null) return 1;
  const quantity = Number(activity.count);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
};

export const hasInvalidActivityQuantity = (activity: Activity) =>
  activity.count !== undefined &&
  activity.count !== null &&
  (!Number.isFinite(Number(activity.count)) || Number(activity.count) <= 0);

export const getActivityGrossAmount = (activity: Activity) =>
  (Number(activity.price) || 0) * getActivityQuantity(activity);

export const getActivityCostAmount = (activity: Activity) =>
  (Number(activity.cost) || 0) * getActivityQuantity(activity);

export const hasRecordedActivityCost = (activity: Activity) =>
  activity.cost !== undefined && activity.cost !== null && Number.isFinite(Number(activity.cost)) && Number(activity.cost) >= 0;

const isSameLocalDay = (date: Date | null, reference: Date) =>
  !!date &&
  date.getFullYear() === reference.getFullYear() &&
  date.getMonth() === reference.getMonth() &&
  date.getDate() === reference.getDate();

const isSameLocalMonth = (date: Date | null, reference: Date) =>
  !!date &&
  date.getFullYear() === reference.getFullYear() &&
  date.getMonth() === reference.getMonth();

const getLocalDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const getInStockProducts = (products: Product[]) =>
  products.filter((product) => product.status === 'instock' && Number(product.stock) >= 0);

export const getPendingProducts = (products: Product[]) =>
  products.filter((product) => product.status === 'shipping');

export const buildInventoryAnalytics = (
  products: Product[],
  activities: Activity[],
  now = new Date()
) => {
  const inStockProducts = getInStockProducts(products);
  const pendingProducts = getPendingProducts(products);
  const outboundActivities = activities.filter((activity) => activity.type === 'outbound');
  const inboundActivities = activities.filter((activity) => activity.type === 'inbound');
  const monthActivities = activities.filter((activity) => isSameLocalMonth(getActivityDate(activity), now));
  const todayOutboundActivities = outboundActivities.filter((activity) => isSameLocalDay(getActivityDate(activity), now));
  const todayInboundActivities = inboundActivities.filter((activity) => isSameLocalDay(getActivityDate(activity), now));

  const totalStock = inStockProducts.reduce((sum, product) => sum + (Number(product.stock) || 0), 0);
  const totalInventoryValue = inStockProducts.reduce(
    (sum, product) => sum + ((Number(product.price) || 0) * (Number(product.stock) || 0)),
    0
  );

  const totalInboundCount = inboundActivities.reduce((sum, activity) => sum + getActivityQuantity(activity), 0);
  const totalOutboundCount = outboundActivities.reduce((sum, activity) => sum + getActivityQuantity(activity), 0);

  const todaySalesAmount = todayOutboundActivities.reduce((sum, activity) => sum + getActivityGrossAmount(activity), 0);
  const todaySalesCount = todayOutboundActivities.reduce((sum, activity) => sum + getActivityQuantity(activity), 0);
  const todayInboundCount = todayInboundActivities.reduce((sum, activity) => sum + getActivityQuantity(activity), 0);

  const monthOutboundActivities = monthActivities.filter((activity) => activity.type === 'outbound');
  const monthInboundActivities = monthActivities.filter((activity) => activity.type === 'inbound');
  const monthSalesAmount = monthOutboundActivities.reduce((sum, activity) => sum + getActivityGrossAmount(activity), 0);
  const monthCostedOutboundActivities = monthOutboundActivities.filter(hasRecordedActivityCost);
  const monthCostedSalesAmount = monthCostedOutboundActivities.reduce((sum, activity) => sum + getActivityGrossAmount(activity), 0);
  const monthCostAmount = monthCostedOutboundActivities.reduce((sum, activity) => sum + getActivityCostAmount(activity), 0);
  const monthGrossProfitAmount = monthCostedSalesAmount - monthCostAmount;
  const monthGrossMarginRate = monthCostedSalesAmount > 0 ? (monthGrossProfitAmount / monthCostedSalesAmount) * 100 : 0;
  const monthInboundCount = monthInboundActivities.reduce((sum, activity) => sum + getActivityQuantity(activity), 0);
  const monthOutboundCount = monthOutboundActivities.reduce((sum, activity) => sum + getActivityQuantity(activity), 0);
  const monthCostedOutboundCount = monthCostedOutboundActivities.reduce((sum, activity) => sum + getActivityQuantity(activity), 0);
  const monthMissingCostCount = monthOutboundCount - monthCostedOutboundCount;
  const monthCostCoverageRate = monthOutboundCount > 0 ? (monthCostedOutboundCount / monthOutboundCount) * 100 : 100;
  const monthEstimatedProfitActivities = monthCostedOutboundActivities.filter((activity) =>
    activity.estimatedNetProfit !== undefined && Number.isFinite(Number(activity.estimatedNetProfit))
  );
  const monthActualSettlementActivities = monthOutboundActivities.filter((activity) =>
    activity.actualPlatformFee !== undefined && Number.isFinite(Number(activity.actualPlatformFee))
  );
  const monthActualProfitActivities = monthCostedOutboundActivities.filter((activity) =>
    activity.actualNetProfit !== undefined && Number.isFinite(Number(activity.actualNetProfit))
  );
  const monthEstimatedNetProfitAmount = monthEstimatedProfitActivities.reduce((sum, activity) => sum + Number(activity.estimatedNetProfit), 0);
  const monthActualNetProfitAmount = monthActualProfitActivities.reduce((sum, activity) => sum + Number(activity.actualNetProfit), 0);
  const monthEstimatedProfitCount = monthEstimatedProfitActivities.reduce((sum, activity) => sum + getActivityQuantity(activity), 0);
  const monthSettledCount = monthActualSettlementActivities.reduce((sum, activity) => sum + getActivityQuantity(activity), 0);
  const monthActualProfitCount = monthActualProfitActivities.reduce((sum, activity) => sum + getActivityQuantity(activity), 0);

  const salesTrendMap = new Map<string, { name: string; value: number }>();
  const rollingStart = new Date(now);
  rollingStart.setHours(0, 0, 0, 0);
  rollingStart.setDate(rollingStart.getDate() - 29);
  const rollingEnd = new Date(now);
  rollingEnd.setHours(23, 59, 59, 999);

  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    salesTrendMap.set(getLocalDateKey(date), {
      name: `${date.getMonth() + 1}/${date.getDate()}`,
      value: 0,
    });
  }
  outboundActivities.forEach((activity) => {
    const activityDate = getActivityDate(activity);
    if (!activityDate || activityDate < rollingStart || activityDate > rollingEnd) return;
    const key = getLocalDateKey(activityDate);
    const current = salesTrendMap.get(key);
    if (current) {
      current.value += getActivityGrossAmount(activity);
    }
  });

  const topBrandsMap = new Map<string, number>();
  inStockProducts.forEach((product) => {
    const brand = product.brand || '其他';
    topBrandsMap.set(brand, (topBrandsMap.get(brand) || 0) + (Number(product.stock) || 0));
  });

  const topProductsMap = new Map<string, number>();
  outboundActivities.forEach((activity) => {
    topProductsMap.set(activity.productName, (topProductsMap.get(activity.productName) || 0) + getActivityQuantity(activity));
  });

  const topStockProductsMap = new Map<string, { name: string; sku: string; stock: number }>();
  inStockProducts.forEach((product) => {
    const key = product.sku || product.id;
    const existing = topStockProductsMap.get(key);
    if (existing) {
      existing.stock += Number(product.stock) || 0;
      return;
    }
    topStockProductsMap.set(key, {
      name: product.name,
      sku: product.sku,
      stock: Number(product.stock) || 0,
    });
  });

  return {
    dataQuality: {
      negativeStockCount: products.filter((product) => Number(product.stock) < 0).length,
      invalidActivityCount: activities.filter(hasInvalidActivityQuantity).length,
    },
    dashboard: {
      pendingOrderCount: pendingProducts.length,
      todaySalesAmount,
      todaySalesCount,
      todayInboundCount,
      totalStock,
      totalInventoryValue,
    },
    lifetime: {
      totalInboundCount,
      totalOutboundCount,
    },
    monthly: {
      salesAmount: monthSalesAmount,
      costedSalesAmount: monthCostedSalesAmount,
      costAmount: monthCostAmount,
      grossProfitAmount: monthGrossProfitAmount,
      grossMarginRate: monthGrossMarginRate,
      costCoverageRate: monthCostCoverageRate,
      missingCostCount: monthMissingCostCount,
      costedOutboundCount: monthCostedOutboundCount,
      estimatedNetProfitAmount: monthEstimatedNetProfitAmount,
      estimatedProfitCount: monthEstimatedProfitCount,
      estimatedProfitCoverageRate: monthCostedOutboundCount > 0 ? (monthEstimatedProfitCount / monthCostedOutboundCount) * 100 : 100,
      actualNetProfitAmount: monthActualNetProfitAmount,
      actualProfitCount: monthActualProfitCount,
      actualProfitCoverageRate: monthCostedOutboundCount > 0 ? (monthActualProfitCount / monthCostedOutboundCount) * 100 : 100,
      settlementCoverageRate: monthOutboundCount > 0 ? (monthSettledCount / monthOutboundCount) * 100 : 100,
      pendingSettlementCount: Math.max(0, monthOutboundCount - monthSettledCount),
      inboundCount: monthInboundCount,
      outboundCount: monthOutboundCount,
    },
    charts: {
      salesTrend: Array.from(salesTrendMap.values()),
      topBrands: Array.from(topBrandsMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
      topProducts: Array.from(topProductsMap.entries())
        .map(([name, sold]) => ({ name, sold }))
        .sort((a, b) => b.sold - a.sold)
        .slice(0, 5),
      topStockProducts: Array.from(topStockProductsMap.values())
        .sort((a, b) => b.stock - a.stock)
        .slice(0, 5),
    },
    pendingProducts,
  };
};
