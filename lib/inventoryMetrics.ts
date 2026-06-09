import { Activity, Product } from '../types';

const isValidDate = (value?: string) => {
  if (!value) return false;
  return !Number.isNaN(new Date(value).getTime());
};

const getActivityDate = (activity: Activity) => {
  const value = activity.created_at || activity.createdAt;
  return isValidDate(value) ? new Date(value as string) : null;
};

export const getActivityQuantity = (activity: Activity) => {
  const quantity = Number(activity.count);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
};

export const getActivityGrossAmount = (activity: Activity) =>
  (Number(activity.price) || 0) * getActivityQuantity(activity);

export const getActivityCostAmount = (activity: Activity) =>
  (Number(activity.cost) || 0) * getActivityQuantity(activity);

const isSameLocalDay = (date: Date | null, reference: Date) =>
  !!date &&
  date.getFullYear() === reference.getFullYear() &&
  date.getMonth() === reference.getMonth() &&
  date.getDate() === reference.getDate();

const isSameLocalMonth = (date: Date | null, reference: Date) =>
  !!date &&
  date.getFullYear() === reference.getFullYear() &&
  date.getMonth() === reference.getMonth();

const getInStockProducts = (products: Product[]) =>
  products.filter((product) => product.status === 'instock');

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
  const monthCostAmount = monthOutboundActivities.reduce((sum, activity) => sum + getActivityCostAmount(activity), 0);
  const monthProfitAmount = monthSalesAmount - monthCostAmount;
  const monthProfitRate = monthSalesAmount > 0 ? (monthProfitAmount / monthSalesAmount) * 100 : 0;
  const monthInboundCount = monthInboundActivities.reduce((sum, activity) => sum + getActivityQuantity(activity), 0);
  const monthOutboundCount = monthOutboundActivities.reduce((sum, activity) => sum + getActivityQuantity(activity), 0);

  const salesTrendMap = new Map<string, number>();
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    salesTrendMap.set(`${date.getMonth() + 1}/${date.getDate()}`, 0);
  }
  outboundActivities.forEach((activity) => {
    const activityDate = getActivityDate(activity);
    if (!activityDate) return;
    const key = `${activityDate.getMonth() + 1}/${activityDate.getDate()}`;
    if (salesTrendMap.has(key)) {
      salesTrendMap.set(key, (salesTrendMap.get(key) || 0) + getActivityGrossAmount(activity));
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
      costAmount: monthCostAmount,
      profitAmount: monthProfitAmount,
      profitRate: monthProfitRate,
      inboundCount: monthInboundCount,
      outboundCount: monthOutboundCount,
      soldCount: monthOutboundCount,
    },
    charts: {
      salesTrend: Array.from(salesTrendMap.entries()).map(([name, value]) => ({ name, value })),
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
