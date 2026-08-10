import { supabase } from '../lib/supabase';
import { Product } from '../types';
import { mapProductFromDb, mapProductToDb } from './mappers';
import { mergeProductsWithLocalMetadata } from './productMetadata';
import { isProductImageRef, resolveStorageImageUrl } from './storageImages';
import { fetchAllPages } from './pagination';
import { parseInventoryGroupSearchEnvelope } from '../lib/analyticsValidation';
import { normalizeSku } from '../lib/productNormalization';

export interface ListProductsParams {
  userId: string;
  warehouse?: string;
  status?: Product['status'];
  search?: string;
  minStock?: number;
  page?: number;
  pageSize?: number;
}

export interface ProductPage {
  products: Product[];
  totalCount: number;
}

const escapeOrValue = (value: string) => value.replace(/[\\%(),_]/g, '\\$&');

export const listProducts = async ({
  userId,
  warehouse,
  status,
  search,
  minStock = 0,
  page = 1,
  pageSize = 50,
}: ListProductsParams): Promise<ProductPage> => {
  let query = supabase
    .from('products')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('stock', minStock);

  if (warehouse) {
    query = query.eq('warehouse', warehouse);
  }

  if (status) {
    query = query.eq('status', status);
  }

  if (search?.trim()) {
    const q = escapeOrValue(search.trim());
    query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,brand.ilike.%${q}%`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);

  if (error) throw error;

  const products = await Promise.all((data || []).map(async (row) => {
    const product = mapProductFromDb(row);
    return { ...product, imageUrl: await resolveStorageImageUrl(product.imageStorageRef || product.imageUrl) };
  }));

  return {
    products: await mergeProductsWithLocalMetadata(userId, products),
    totalCount: count || 0,
  };
};

const resolveProductRows = async (userId: string, rows: unknown[]): Promise<Product[]> => {
  const products = await Promise.all(rows.map(async (row) => {
    if (!row || typeof row !== 'object') throw new Error('商品查询返回了无效数据');
    const product = mapProductFromDb(row as Record<string, unknown>);
    return { ...product, imageUrl: await resolveStorageImageUrl(product.imageStorageRef || product.imageUrl) };
  }));
  return mergeProductsWithLocalMetadata(userId, products);
};

export const suggestInventorySkus = async (userId: string, prefix: string, limit = 5): Promise<Product[]> => {
  const normalizedPrefix = normalizeSku(prefix);
  if (normalizedPrefix.length < 2) return [];
  const { data, error } = await supabase.rpc('suggest_inventory_skus', {
    p_prefix: normalizedPrefix,
    p_limit: Math.min(Math.max(Math.trunc(limit), 1), 5),
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('货号联想返回了无效数据');
  return resolveProductRows(userId, data);
};

export const listActiveSkuVariants = async (userId: string, sku: string): Promise<Product[]> => {
  const normalizedSku = normalizeSku(sku);
  const { data, error } = await supabase.rpc('list_active_sku_variants', {
    p_sku: normalizedSku,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('同货号库存返回了无效数据');
  return resolveProductRows(userId, data);
};

export interface ProductGroupSearchPage {
  products: Product[];
  groupCount: number;
  inventoryStock: number;
  rowCount: number;
  page: number;
  pageSize: number;
}

export const searchProductGroups = async ({
  warehouse, status, search, page = 1, pageSize = 20,
}: Omit<ListProductsParams, 'userId'>): Promise<ProductGroupSearchPage> => {
  const { data, error } = await supabase.rpc('search_inventory_groups', {
    p_warehouse: warehouse,
    p_status: status || null,
    p_search: search?.trim() || null,
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) throw error;
  const envelope = parseInventoryGroupSearchEnvelope(data);
  const rows = envelope.products;
  const products = await Promise.all(rows.map(async (row: any) => {
    const product = mapProductFromDb(row);
    return { ...product, imageUrl: await resolveStorageImageUrl(product.imageStorageRef || product.imageUrl) };
  }));
  return {
    products,
    groupCount: envelope.groupCount,
    inventoryStock: envelope.inventoryStock,
    rowCount: envelope.rowCount,
    page: envelope.page,
    pageSize: envelope.pageSize,
  };
};

export const getWarehouseProductSummary = async (userId: string, warehouse: string) => {
  const { data, error } = await supabase
    .from('products')
    .select('price, stock')
    .eq('user_id', userId)
    .eq('warehouse', warehouse)
    .is('deleted_at', null)
    .eq('status', 'instock')
    .gte('stock', 0);

  if (error) throw error;

  return (data || []).reduce(
    (summary, item) => ({
      count: summary.count + (Number(item.stock) || 0),
      value: summary.value + ((Number(item.price) || 0) * (Number(item.stock) || 0)),
    }),
    { count: 0, value: 0 }
  );
};

export const updateProductMetadata = async (
  product: Product,
  _userId: string,
  trustedImageRef?: string,
) => {
  const { error } = await supabase.rpc('update_product_metadata', {
    p_brand: product.brand,
    p_image_ref: trustedImageRef || null,
    p_location: product.location || '',
    p_name: product.name,
    p_product_id: product.id,
    p_source: product.source || '',
  });

  if (error) throw error;
};

export const deleteProduct = async (productId: string, _userId: string) => {
  const { error } = await supabase.rpc('soft_delete_products', {
    p_product_ids: [productId],
  });

  if (error) throw error;
};
export const deleteProducts = async (productIds: string[]) => {
  const { error } = await supabase.rpc('soft_delete_products', {
    p_product_ids: productIds,
  });
  if (error) throw error;
};

export const completePendingProducts = async (productIds: string[]) => {
  const { error } = await supabase.rpc('complete_pending_products', {
    p_product_ids: productIds,
  });
  if (error) throw error;
};

export const listDeletedProducts = async (userId: string): Promise<Product[]> => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error) throw error;
  return Promise.all((data || []).map(async (row) => {
    const product = mapProductFromDb(row);
    return { ...product, imageUrl: await resolveStorageImageUrl(product.imageStorageRef || product.imageUrl) };
  }));
};

export const listProductsForExport = async (userId: string): Promise<Product[]> => {
  const rows = await fetchAllPages((from, to) => supabase
    .from('products')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to), { getKey: (row: any) => String(row.id), label: '库存 CSV' });
  return rows.map(mapProductFromDb);
};

export const restoreProduct = async (productId: string, userId: string): Promise<{ merged: boolean; productId: string }> => {
  const { data, error } = await supabase.rpc('restore_product', {
    p_product_id: productId,
    p_user_id: userId,
  });

  if (error) throw error;
  return {
    merged: Boolean(data?.merged),
    productId: String(data?.product_id || productId),
  };
};

interface BatchInboundResult {
  inputIndex: number;
  productId: string;
  merged: boolean;
  stock: number;
  averageCost: number;
}

export const batchInboundProducts = async (products: Product[], userId: string): Promise<BatchInboundResult[]> => {
  const rows = products.map((product) => {
    const normalized = mapProductToDb(product, userId);
    return {
      id: normalized.id,
      name: normalized.name,
      brand: normalized.brand,
      sku: normalized.sku,
      size: normalized.size,
      cost: normalized.price,
      quantity: normalized.stock,
      image_url: isProductImageRef(product.imageStorageRef)
        ? product.imageStorageRef
        : isProductImageRef(product.imageUrl) ? product.imageUrl : '',
      status: normalized.status,
      location: normalized.location,
      warehouse: normalized.warehouse,
      source: normalized.source,
    };
  });

  const { data, error } = await supabase.rpc('batch_inbound_products', {
    p_batch_id: `manual-${products[0]?.id || Date.now()}`,
    p_rows: rows,
    p_platform: '手动批量入库',
    p_user_id: userId,
  });

  if (error) throw error;
  const results = Array.isArray(data) ? data.map((item: any) => ({
    inputIndex: Number(item.input_index),
    productId: String(item.product_id),
    merged: Boolean(item.merged),
    stock: Number(item.stock),
    averageCost: Number(item.average_cost),
  })) : [];

  return results;
};
