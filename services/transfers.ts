import { supabase } from '../lib/supabase';

interface TransferProductParams {
  productId: string;
  userId: string;
  targetWarehouse: string;
  quantity: number;
  targetLocation?: string;
  operationId: string;
}

export interface TransferResult {
  sourceProductId: string;
  targetProductId: string;
  sourceStock: number;
  targetStock: number;
  quantity: number;
  sourceWarehouse: string;
  targetWarehouse: string;
}

export const transferProduct = async ({
  productId,
  userId,
  targetWarehouse,
  quantity,
  targetLocation = '',
  operationId,
}: TransferProductParams): Promise<TransferResult> => {
  const { data, error } = await supabase.rpc('transfer_product', {
    p_operation_id: operationId,
    p_product_id: productId,
    p_quantity: quantity,
    p_target_location: targetLocation,
    p_target_warehouse: targetWarehouse,
    p_user_id: userId,
  });

  if (error) throw error;
  return {
    sourceProductId: String(data.source_product_id),
    targetProductId: String(data.target_product_id),
    sourceStock: Number(data.source_stock),
    targetStock: Number(data.target_stock),
    quantity: Number(data.quantity),
    sourceWarehouse: String(data.source_warehouse),
    targetWarehouse: String(data.target_warehouse),
  };
};
