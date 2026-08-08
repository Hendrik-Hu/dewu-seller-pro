import { supabase } from '../lib/supabase';
import { Product } from '../types';
import { createInventoryActivity } from './activities';
import { normalizeOutboundQuantity, normalizeSalePrice } from '../lib/outboundRules';

export interface OutboundParams {
  product: Product;
  userId: string;
  salePrice: number;
  quantity?: number;
  platform?: string;
}

const isMissingRpcError = (error: any) => {
  const message = String(error?.message || '');
  return error?.code === 'PGRST202' || message.includes('Could not find the function');
};

const fallbackOutboundProduct = async ({
  product,
  userId,
  salePrice,
  quantity = 1,
}: OutboundParams) => {
  const validatedQuantity = normalizeOutboundQuantity(quantity, product.stock);
  const validatedSalePrice = normalizeSalePrice(salePrice);
  const nextStock = product.stock - validatedQuantity;

  const { data: updatedRows, error: updateError } = await supabase
    .from('products')
    .update({
      stock: nextStock,
      status: nextStock <= 0 ? 'sold' : product.status,
    })
    .eq('id', product.id)
    .eq('user_id', userId)
    .eq('stock', product.stock)
    .select('id');

  if (updateError) throw updateError;
  if (!updatedRows?.length) {
    throw new Error('库存已变化，请刷新后重试。');
  }

  await createInventoryActivity({
    userId,
    type: 'outbound',
    productName: product.name,
    sku: product.sku,
    size: product.size,
    price: validatedSalePrice,
    cost: product.price,
    imageUrl: product.imageUrl,
    warehouse: product.warehouse,
    count: validatedQuantity,
  }).catch(async (activityError) => {
    const { error: rollbackError } = await supabase
      .from('products')
      .update({ stock: product.stock, status: product.status })
      .eq('id', product.id)
      .eq('user_id', userId)
      .eq('stock', nextStock);

    if (rollbackError) {
      throw new Error(`出库流水写入失败，库存自动恢复也失败：${String(activityError?.message || activityError)}`);
    }

    throw activityError;
  });
};

export const outboundProduct = async ({
  product,
  userId,
  salePrice,
  quantity = 1,
  platform = '得物',
}: OutboundParams) => {
  const validatedQuantity = normalizeOutboundQuantity(quantity, product.stock);
  const validatedSalePrice = normalizeSalePrice(salePrice);

  if (!product.id || !userId) throw new Error('商品或用户信息不完整，请刷新后重试。');

  const { error } = await supabase.rpc('outbound_product', {
    p_product_id: product.id,
    p_user_id: userId,
    p_sale_price: validatedSalePrice,
    p_quantity: validatedQuantity,
    p_platform: platform,
  });

  if (!error) return;

  if (isMissingRpcError(error)) {
    await fallbackOutboundProduct({ product, userId, salePrice: validatedSalePrice, quantity: validatedQuantity, platform });
    return;
  }

  throw error;
};
