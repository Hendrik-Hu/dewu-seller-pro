import { supabase } from '../lib/supabase';
import { Product } from '../types';
import { createInventoryActivity } from './activities';

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
  const nextStock = product.stock - quantity;

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
    price: salePrice,
    cost: product.price,
    imageUrl: product.imageUrl,
    warehouse: product.warehouse,
    count: quantity,
  });
};

export const outboundProduct = async ({
  product,
  userId,
  salePrice,
  quantity = 1,
  platform = '得物',
}: OutboundParams) => {
  if (quantity <= 0) {
    throw new Error('出库数量必须大于 0。');
  }

  if (product.stock < quantity) {
    throw new Error('库存不足。');
  }

  const { error } = await supabase.rpc('outbound_product', {
    p_product_id: product.id,
    p_user_id: userId,
    p_sale_price: salePrice,
    p_quantity: quantity,
    p_platform: platform,
  });

  if (!error) return;

  if (isMissingRpcError(error)) {
    await fallbackOutboundProduct({ product, userId, salePrice, quantity, platform });
    return;
  }

  throw error;
};
