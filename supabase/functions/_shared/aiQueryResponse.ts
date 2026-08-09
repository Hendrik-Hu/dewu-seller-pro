import { formatAiInventorySummaryAnswer } from './aiInventorySummary.ts';

const executionPattern = /入库|进货|补货|新增|出库|卖了|卖掉|卖出|售出|发货/;
const globalSummaryPattern = /总结|分析|库存情况|经营情况|整体库存|库存总|多少库存|库存有多少|经营总结/;
const skuQueryPattern = /库存|多少|尺码|成本|仓库|查询|查一下|情况|有哪些/;

const numberOr = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const text = (value: unknown) => String(value || '').trim();

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
  if (globalSummaryPattern.test(normalized)) return formatAiInventorySummaryAnswer(context?.summary);
  const relevantProducts = Array.isArray(context?.relevantProducts) ? context.relevantProducts : [];
  if (relevantProducts.length > 0 && skuQueryPattern.test(normalized)) {
    return formatRelevantSkuInventoryAnswer(relevantProducts);
  }
  return null;
};
