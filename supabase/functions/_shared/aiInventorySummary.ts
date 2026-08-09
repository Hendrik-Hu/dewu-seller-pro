interface SummaryProduct {
  sku?: unknown;
  stock?: unknown;
  price?: unknown;
  status?: unknown;
}

interface SummaryActivity {
  type?: unknown;
  count?: unknown;
  price?: unknown;
  cost?: unknown;
  created_at?: unknown;
}

const numberOr = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const quantityOf = (activity: SummaryActivity) => {
  const quantity = Number(activity.count);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
};

const hasRecordedCost = (activity: SummaryActivity) =>
  activity.cost !== undefined &&
  activity.cost !== null &&
  Number.isFinite(Number(activity.cost)) &&
  Number(activity.cost) >= 0;

const shanghaiMonthKey = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  return `${year}-${month}`;
};

export const buildAiInventorySummary = (
  products: SummaryProduct[],
  activities: SummaryActivity[],
  now = new Date(),
) => {
  const currentMonth = shanghaiMonthKey(now);
  const inStockProducts = products.filter((item) => item.status === "instock");
  let monthSales = 0;
  let monthCostedSales = 0;
  let monthKnownCost = 0;
  let monthInbound = 0;
  let monthOutbound = 0;
  let monthCostedOutbound = 0;

  for (const activity of activities) {
    const createdAt = new Date(String(activity.created_at || ""));
    if (Number.isNaN(createdAt.getTime()) || shanghaiMonthKey(createdAt) !== currentMonth) continue;
    const count = quantityOf(activity);
    if (activity.type === "outbound") {
      const gross = numberOr(activity.price) * count;
      monthOutbound += count;
      monthSales += gross;
      if (hasRecordedCost(activity)) {
        monthCostedOutbound += count;
        monthCostedSales += gross;
        monthKnownCost += numberOr(activity.cost) * count;
      }
    } else if (activity.type === "inbound") {
      monthInbound += count;
    }
  }

  return {
    variants: inStockProducts.length,
    skus: new Set(inStockProducts.map((item) => String(item.sku || "").trim().toUpperCase()).filter(Boolean)).size,
    stock: inStockProducts.reduce((sum, item) => sum + Math.max(0, numberOr(item.stock)), 0),
    value: Number(inStockProducts.reduce(
      (sum, item) => sum + Math.max(0, numberOr(item.stock)) * Math.max(0, numberOr(item.price)),
      0,
    ).toFixed(2)),
    monthSales: Number(monthSales.toFixed(2)),
    monthCostedSales: Number(monthCostedSales.toFixed(2)),
    monthKnownCost: Number(monthKnownCost.toFixed(2)),
    monthGrossProfit: Number((monthCostedSales - monthKnownCost).toFixed(2)),
    monthInbound,
    monthOutbound,
    costCoverage: monthOutbound > 0 ? Number(((monthCostedOutbound / monthOutbound) * 100).toFixed(1)) : 100,
    missingCostCount: monthOutbound - monthCostedOutbound,
  };
};

export const formatAiInventorySummaryAnswer = (summary: ReturnType<typeof buildAiInventorySummary>) =>
  `当前在售库存共 ${summary.skus} 款、${summary.stock} 件，预估总值 ¥${summary.value}。` +
  `本月入库 ${summary.monthInbound} 件、出库 ${summary.monthOutbound} 件、销售额 ¥${summary.monthSales}。` +
  `已记录成本的销售额 ¥${summary.monthCostedSales}，毛利润 ¥${summary.monthGrossProfit}，成本覆盖率 ${summary.costCoverage}%` +
  (summary.missingCostCount > 0 ? `，另有 ${summary.missingCostCount} 件出库缺少成本，未计入毛利润。` : '。');
