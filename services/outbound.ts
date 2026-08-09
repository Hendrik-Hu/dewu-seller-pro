import { supabase } from '../lib/supabase';
import { Product } from '../types';
import { normalizeOutboundQuantity, normalizeSalePrice } from '../lib/outboundRules';
import type { OutboundFeeSelection } from '../types';

export interface OutboundParams {
  product: Product;
  userId: string;
  salePrice: number;
  quantity?: number;
  platform?: string;
  operationId: string;
  feeSelection: OutboundFeeSelection;
}

export const outboundProduct = async ({
  product,
  userId,
  salePrice,
  quantity = 1,
  platform = '得物',
  operationId,
  feeSelection,
}: OutboundParams) => {
  const validatedQuantity = normalizeOutboundQuantity(quantity, product.stock);
  const validatedSalePrice = normalizeSalePrice(salePrice);

  if (!product.id || !userId) throw new Error('商品或用户信息不完整，请刷新后重试。');

  if (!operationId || operationId.length < 8) throw new Error('出库操作号无效，请重新打开出库页面。');

  const { data, error } = await supabase.rpc('outbound_product_with_fees', {
    p_fee_scheme_id: feeSelection.schemeId || null,
    p_fee_scheme_updated_at: feeSelection.schemeUpdatedAt || null,
    p_manual_fee_override: feeSelection.manualFeeOverride ?? null,
    p_operation_id: operationId,
    p_platform: platform,
    p_product_id: product.id,
    p_quantity: validatedQuantity,
    p_sale_price: validatedSalePrice,
    p_user_id: userId,
  });
  if (error) throw error;
  return data;
};
