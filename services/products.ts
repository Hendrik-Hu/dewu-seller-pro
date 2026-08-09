import { supabase } from '../lib/supabase';
import { Product } from '../types';
import { mapProductFromDb, mapProductToDb } from './mappers';
import { mergeProductsWithLocalMetadata, saveProductLocalMetadata } from './productMetadata';
import { normalizeSku } from '../lib/productNormalization';
import { resolveStorageImageUrl } from './storageImages';
import { fetchAllPages } from './pagination';

export interface ListProductsParams {
  userId: string;
  warehouse?: string;
  status?: Product['status'];
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ProductPage {
  products: Product[];
  totalCount: number;
}

const escapeOrValue = (value: string) => value.replace(/[%(),]/g, '\\$&');
const isMissingSourceColumnError = (error: any) => String(error?.message || '').includes('source');

export const listProducts = async ({
  userId,
  warehouse,
  status,
  search,
  page = 1,
  pageSize = 50,
}: ListProductsParams): Promise<ProductPage> => {
  let query = supabase
    .from('products')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('stock', 0);

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

export const listAllProducts = async (userId: string): Promise<Product[]> => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  const products = await Promise.all((data || []).map(async (row) => {
    const product = mapProductFromDb(row);
    return { ...product, imageUrl: await resolveStorageImageUrl(product.imageStorageRef || product.imageUrl) };
  }));
  return mergeProductsWithLocalMetadata(userId, products);
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

export const upsertProduct = async (product: Product, userId: string) => {
  const dbRow = mapProductToDb(product, userId);
  let { error } = await supabase
    .from('products')
    .upsert(dbRow);

  if (error && isMissingSourceColumnError(error)) {
    const { source: _source, ...fallbackRow } = dbRow;
    const retry = await supabase
      .from('products')
      .upsert(fallbackRow);
    error = retry.error;
  }

  if (error) throw error;
  await saveProductLocalMetadata(userId, product);
};

export const deleteProduct = async (productId: string, userId: string) => {
  const { error } = await supabase
    .from('products')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('user_id', userId);

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
      image_url: normalized.image_url,
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

  const metadataWrites = await Promise.allSettled(results.map((result) => {
    const product = products[result.inputIndex];
    return product ? saveProductLocalMetadata(userId, { ...product, id: result.productId }) : Promise.resolve();
  }));
  if (metadataWrites.some((result) => result.status === 'rejected')) {
    console.warn('Inbound committed, but some local product metadata could not be cached.');
  }

  return results;
};

export const updateProductStock = async (productId: string, userId: string, stock: number) => {
  const { error } = await supabase
    .from('products')
    .update({ stock })
    .eq('id', productId)
    .eq('user_id', userId);

  if (error) throw error;
};

export const updateProductStatus = async (
  productId: string,
  userId: string,
  status: Product['status']
) => {
  const { error } = await supabase
    .from('products')
    .update({ status })
    .eq('id', productId)
    .eq('user_id', userId);

  if (error) throw error;
};

export const batchUpdateProductStatus = async (
  productIds: string[],
  userId: string,
  status: Product['status']
) => {
  if (productIds.length === 0) return;

  const { error } = await supabase
    .from('products')
    .update({ status })
    .in('id', productIds)
    .eq('user_id', userId);

  if (error) throw error;
};

export const renameProductsWarehouse = async (userId: string, oldName: string, newName: string) => {
  const { error } = await supabase
    .from('products')
    .update({ warehouse: newName })
    .eq('warehouse', oldName)
    .eq('user_id', userId);

  if (error) throw error;
};

export const syncProductMainImageBySku = async (userId: string, sku: string, imageUrl: string) => {
  const { error } = await supabase
    .from('products')
    .update({ image_url: imageUrl })
    .eq('user_id', userId)
    .ilike('sku', normalizeSku(sku));

  if (error) throw error;
};
