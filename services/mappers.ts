import { Activity, Product, Warehouse } from '../types';

const DEFAULT_WAREHOUSE_NAME = '鏉窞涓€鍙蜂粨';

export const mapProductFromDb = (row: any): Product => ({
  id: row.id,
  name: row.name,
  brand: row.brand,
  size: row.size,
  sku: row.sku,
  price: Number(row.price) || 0,
  stock: Number(row.stock) || 0,
  imageUrl: row.image_url || row.imageUrl || '',
  status: row.status || 'instock',
  location: row.location || '',
  warehouse: row.warehouse || DEFAULT_WAREHOUSE_NAME,
  source: row.source || '',
});

export const mapProductToDb = (product: Product, userId: string) => ({
  id: product.id,
  name: product.name,
  brand: product.brand,
  size: product.size,
  sku: product.sku,
  price: product.price,
  stock: product.stock,
  image_url: product.imageUrl,
  status: product.status,
  location: product.location,
  warehouse: product.warehouse,
  source: product.source,
  created_at: new Date().toISOString(),
  user_id: userId,
});

export const mapActivityFromDb = (row: any): Activity => ({
  id: row.id,
  type: row.type,
  productName: row.product_name || row.productName,
  time: row.time,
  sku: row.sku,
  size: row.size,
  price: Number(row.price) || 0,
  cost: row.cost == null ? undefined : Number(row.cost),
  imageUrl: row.image_url || row.imageUrl || '',
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
  sku: activity.sku,
  size: activity.size,
  price: activity.price,
  cost: activity.cost,
  image_url: activity.imageUrl,
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
