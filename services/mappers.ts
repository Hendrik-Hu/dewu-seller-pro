import { Activity, Product, Warehouse } from '../types';
import {
  normalizeBrand,
  normalizeProduct,
  normalizeOptionalStoredCost,
  normalizeSize,
  normalizeSku,
  normalizeStock,
  normalizeStoredCost,
} from '../lib/productNormalization';
import { isProductImageRef } from './storageImages';

export const mapProductFromDb = (row: any): Product => ({
  id: row.id,
  name: String(row.name || '').trim() || normalizeSku(row.sku),
  brand: normalizeBrand(row.brand),
  size: normalizeSize(row.size),
  sku: normalizeSku(row.sku),
  price: normalizeStoredCost(row.price),
  stock: normalizeStock(row.stock),
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
  count: row.count ? Number(row.count) : 1,
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
  count: Number(activity.count || 1),
  user_id: userId,
});

export const mapWarehouseFromDb = (row: any): Warehouse => ({
  id: row.id,
  name: row.name,
  is_default: row.is_default,
});
