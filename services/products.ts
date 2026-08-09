import { supabase } from '../lib/supabase';
import { Product } from '../types';
import { mapProductFromDb, mapProductToDb } from './mappers';
import { deleteProductLocalMetadata, mergeProductsWithLocalMetadata, saveProductLocalMetadata } from './productMetadata';
import { normalizeSku } from '../lib/productNormalization';
import { resolveStorageImageUrl } from './storageImages';

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
    .eq('user_id', userId);

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
    .eq('status', 'instock');

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
    .delete()
    .eq('id', productId)
    .eq('user_id', userId);

  if (error) throw error;
  await deleteProductLocalMetadata(userId, productId);
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
