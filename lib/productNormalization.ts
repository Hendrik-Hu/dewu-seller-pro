import type { Product } from '../types.ts';

export const UNKNOWN_BRAND = '未知品牌';
export const ONE_SIZE = '均码';

const UNKNOWN_BRAND_VALUES = new Set(['', 'unknown', 'n/a', 'null', 'undefined', '未知']);

export const normalizeSku = (value: unknown): string =>
  String(value ?? '').trim().toUpperCase();

export const normalizeBrand = (value: unknown): string => {
  const brand = String(value ?? '').trim();
  return UNKNOWN_BRAND_VALUES.has(brand.toLowerCase()) ? UNKNOWN_BRAND : brand;
};

export const normalizeSize = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return ONE_SIZE;
  if (/^均(?:码)+$/u.test(raw)) return ONE_SIZE;

  const withoutSuffix = raw.replace(/(?:\s*码)+$/u, '').trim();
  if (!withoutSuffix || withoutSuffix === ONE_SIZE) return ONE_SIZE;
  return withoutSuffix;
};

export const formatProductSize = (value: unknown): string => {
  const size = normalizeSize(value);
  return size === ONE_SIZE ? ONE_SIZE : `${size}码`;
};

export const normalizeStoredCost = (value: unknown): number => {
  const cost = Number(value);
  return Number.isFinite(cost) && cost >= 0 ? cost : 0;
};

export const normalizeOptionalStoredCost = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const cost = Number(value);
  return Number.isFinite(cost) && cost >= 0 ? cost : undefined;
};

export const normalizeStock = (value: unknown): number => {
  const stock = Number(value);
  return Number.isFinite(stock) && stock >= 0 ? Math.floor(stock) : 0;
};

export const parseStoredStock = (value: unknown): number => {
  const stock = Number(value);
  return Number.isFinite(stock) ? Math.floor(stock) : 0;
};

export const normalizeProduct = (product: Product): Product => ({
  ...product,
  name: String(product.name ?? '').trim() || normalizeSku(product.sku),
  brand: normalizeBrand(product.brand),
  sku: normalizeSku(product.sku),
  size: normalizeSize(product.size),
  price: normalizeStoredCost(product.price),
  stock: normalizeStock(product.stock),
  warehouse: String(product.warehouse ?? '').trim(),
});

export const sameSkuAndSize = (left: Pick<Product, 'sku' | 'size'>, right: Pick<Product, 'sku' | 'size'>): boolean =>
  normalizeSku(left.sku) === normalizeSku(right.sku) && normalizeSize(left.size) === normalizeSize(right.size);

export const sameInventoryVariant = (
  left: Pick<Product, 'sku' | 'size' | 'warehouse'>,
  right: Pick<Product, 'sku' | 'size' | 'warehouse'>,
): boolean =>
  sameSkuAndSize(left, right) && String(left.warehouse ?? '').trim() === String(right.warehouse ?? '').trim();
