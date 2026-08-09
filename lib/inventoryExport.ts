import type { Product } from '../types.ts';

const CSV_HEADERS = ['货号', '名称', '品牌', '尺码', '库存', '平均成本', '仓库', '库位', '来源', '状态', '是否在回收站'];
const neutralizeSpreadsheetFormula = (value: unknown) => {
  const text = String(value ?? '');
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
};
const escapeCsv = (value: unknown) => `"${neutralizeSpreadsheetFormula(value).replace(/"/g, '""')}"`;

export const buildInventoryCsv = (products: Product[]): string => {
  const lines = products.map((product) => [
    product.sku,
    product.name,
    product.brand,
    product.size,
    product.stock,
    product.price,
    product.warehouse || '',
    product.location || '',
    product.source || '',
    product.status,
    product.deletedAt ? '是' : '否',
  ].map(escapeCsv).join(','));

  return `\uFEFF${CSV_HEADERS.map(escapeCsv).join(',')}\n${lines.join('\n')}`;
};
