const numberOr = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const text = (value: unknown, max: number) => String(value || '').trim().slice(0, max);

const compactSummary = (summary: any) => ({
  sku: summary?.skus ?? summary?.productCount ?? 0,
  stock: summary?.stock ?? summary?.totalStock ?? 0,
  value: summary?.value ?? 0,
  sales: summary?.monthSales ?? 0,
  costedSales: summary?.monthCostedSales ?? 0,
  cost: summary?.monthKnownCost ?? 0,
  profit: summary?.monthGrossProfit ?? 0,
  coverage: summary?.costCoverage ?? 100,
  missing: summary?.missingCostCount ?? 0,
  inbound: summary?.monthInbound ?? 0,
  outbound: summary?.monthOutbound ?? 0,
});

export const serializeAiContext = (context: any, maxLength = 220) => {
  const relevant = Array.isArray(context?.relevantProducts) ? context.relevantProducts : [];

  if (relevant.length > 0) {
    const rows: Array<Record<string, unknown>> = [];
    for (const item of relevant) {
      const row = {
        sku: text(item.sku, 18).toUpperCase(),
        size: text(item.size, 8) || '均码',
        stock: numberOr(item.stock),
        cost: numberOr(item.price),
        warehouse: text(item.warehouse, 14),
      };
      const candidate = JSON.stringify({ products: [...rows, row] });
      if (candidate.length > maxLength) break;
      rows.push(row);
    }
    if (rows.length > 0) return JSON.stringify({ products: rows });
  }

  const full = JSON.stringify({ summary: compactSummary(context?.summary) });
  if (full.length <= maxLength) return full;

  const summary = compactSummary(context?.summary);
  return JSON.stringify({
    s: {
      sku: summary.sku,
      stock: summary.stock,
      value: summary.value,
      sales: summary.sales,
      profit: summary.profit,
      coverage: summary.coverage,
      missing: summary.missing,
    },
  });
};
