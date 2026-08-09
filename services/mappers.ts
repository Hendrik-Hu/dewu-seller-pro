import { Activity, Product, Warehouse } from '../types';
import {
  normalizeBrand,
  normalizeProduct,
  normalizeOptionalStoredCost,
  normalizeSize,
  normalizeSku,
  normalizeStock,
  normalizeStoredCost,
  parseStoredStock,
} from '../lib/productNormalization';
import { isProductImageRef } from './storageImages';
import { normalizeActivityCountForWrite } from '../lib/activityValidation';

export const mapProductFromDb = (row: any): Product => ({
  id: row.id,
  name: String(row.name || '').trim() || normalizeSku(row.sku),
  brand: normalizeBrand(row.brand),
  size: normalizeSize(row.size),
  sku: normalizeSku(row.sku),
  price: normalizeStoredCost(row.price),
  stock: parseStoredStock(row.stock),
  imageUrl: row.image_url || row.imageUrl || '',
  imageStorageRef: isProductImageRef(row.image_url || row.imageUrl) ? (row.image_url || row.imageUrl) : undefined,
  status: row.status || 'instock',
  location: row.location || '',
  warehouse: String(row.warehouse || '').trim(),
  source: row.source || '',
  deletedAt: row.deleted_at || undefined,
});

export const mapProductToDb = (product: Product, userId: string) => {
  const normalized = normalizeProduct(product);
  return {
    id: normalized.id,
    name: normalized.name,
    brand: normalized.brand,
    size: normalized.size,
    sku: normalized.sku,
    price: normalized.price,
    stock: normalized.stock,
    image_url: normalized.imageStorageRef || normalized.imageUrl,
    status: normalized.status,
    location: normalized.location,
    warehouse: normalized.warehouse,
    source: normalized.source,
    deleted_at: normalized.deletedAt || null,
    created_at: new Date().toISOString(),
    user_id: userId,
  };
};

export const mapActivityFromDb = (row: any): Activity => ({
  id: row.id,
  type: row.type,
  productName: row.product_name || row.productName,
  time: row.time,
  sku: normalizeSku(row.sku),
  size: row.size == null ? undefined : normalizeSize(row.size),
  price: normalizeStoredCost(row.price),
  cost: normalizeOptionalStoredCost(row.cost),
  imageUrl: row.image_url || row.imageUrl || '',
  imageStorageRef: isProductImageRef(row.image_url || row.imageUrl) ? (row.image_url || row.imageUrl) : undefined,
  createdAt: row.created_at || row.createdAt,
  created_at: row.created_at,
  warehouse: row.warehouse,
  count: row.count === undefined || row.count === null || row.count === '' ? undefined : Number(row.count),
  source: row.source || '',
  platform: row.platform || '',
  feeSnapshot: row.fee_snapshot || undefined,
  estimatedPlatformFee: row.estimated_platform_fee == null ? undefined : Number(row.estimated_platform_fee),
  estimatedNetProceeds: row.estimated_net_proceeds == null ? undefined : Number(row.estimated_net_proceeds),
  estimatedNetProfit: row.estimated_net_profit == null ? undefined : Number(row.estimated_net_profit),
  actualPlatformFee: row.actual_platform_fee == null ? undefined : Number(row.actual_platform_fee),
  actualNetProceeds: row.actual_net_proceeds == null ? undefined : Number(row.actual_net_proceeds),
  actualNetProfit: row.actual_net_profit == null ? undefined : Number(row.actual_net_profit),
  settledAt: row.settled_at || undefined,
  settlementOrderNo: row.settlement_order_no || undefined,
  settlementNote: row.settlement_note || undefined,
  settlementRevision: row.settlement_revision == null ? undefined : Number(row.settlement_revision),
});

export const mapActivityToDb = (activity: Activity, userId: string) => ({
  id: activity.id,
  type: activity.type,
  product_name: activity.productName,
  time: activity.time,
  sku: normalizeSku(activity.sku),
  size: activity.size == null ? undefined : normalizeSize(activity.size),
  price: activity.price,
  cost: activity.cost,
  image_url: activity.imageStorageRef || activity.imageUrl,
  created_at: activity.created_at || activity.createdAt || new Date().toISOString(),
  warehouse: activity.warehouse,
  count: normalizeActivityCountForWrite(activity.count),
  source: activity.source || '',
  platform: activity.platform || '',
  fee_snapshot: activity.feeSnapshot || null,
  estimated_platform_fee: activity.estimatedPlatformFee ?? null,
  estimated_net_proceeds: activity.estimatedNetProceeds ?? null,
  estimated_net_profit: activity.estimatedNetProfit ?? null,
  actual_platform_fee: activity.actualPlatformFee ?? null,
  actual_net_proceeds: activity.actualNetProceeds ?? null,
  actual_net_profit: activity.actualNetProfit ?? null,
  settled_at: activity.settledAt ?? null,
  settlement_order_no: activity.settlementOrderNo ?? null,
  settlement_note: activity.settlementNote ?? null,
  settlement_revision: activity.settlementRevision ?? 0,
  user_id: userId,
});

export const mapWarehouseFromDb = (row: any): Warehouse => ({
  id: row.id,
  name: row.name,
  is_default: row.is_default,
});
