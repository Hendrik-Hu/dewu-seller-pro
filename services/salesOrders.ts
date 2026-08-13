import { supabase } from '../lib/supabase';
import { normalizeOutboundQuantity, normalizeSalePrice } from '../lib/outboundRules';
import { mapSalesOrderFromDb } from '../lib/salesOrderMapping';
import type { OutboundFeeSelection, Product, SalesOrder, SalesOrderStatus } from '../types';
import type { SalesOrderAction } from '../lib/salesOrderLifecycle';

export interface CreateSalesOrderParams {
  product: Product;
  userId: string;
  unitSalePrice: number;
  quantity: number;
  platform?: string;
  operationId: string;
  feeSelection: OutboundFeeSelection;
  externalOrderNo?: string;
  note?: string;
}

export const createSalesOrder = async ({
  product, userId, unitSalePrice, quantity, platform = '得物', operationId,
  feeSelection, externalOrderNo, note,
}: CreateSalesOrderParams) => {
  if (!product.id || !userId) throw new Error('商品或用户信息不完整，请刷新后重试。');
  if (!operationId || operationId.length < 8) throw new Error('销售订单操作号无效，请重新打开页面。');
  const { data, error } = await supabase.rpc('create_sales_order', {
    p_external_order_no: externalOrderNo?.trim() || null,
    p_fee_scheme_id: feeSelection.schemeId || null,
    p_fee_scheme_updated_at: feeSelection.schemeUpdatedAt || null,
    p_manual_fee_override: feeSelection.manualFeeOverride ?? null,
    p_note: note?.trim() || null,
    p_operation_id: operationId,
    p_platform: platform,
    p_product_id: product.id,
    p_quantity: normalizeOutboundQuantity(quantity, product.stock),
    p_unit_sale_price: normalizeSalePrice(unitSalePrice),
    p_user_id: userId,
  });
  if (error) throw error;
  return data;
};

export const listSalesOrders = async (
  userId: string,
  statuses?: SalesOrderStatus[],
  page = 1,
  pageSize = 20,
): Promise<{ orders: SalesOrder[]; totalCount: number }> => {
  const safePage = Math.max(1, Math.trunc(page));
  const safePageSize = Math.min(50, Math.max(1, Math.trunc(pageSize)));
  let query = supabase.from('sales_orders').select('*', { count: 'exact' }).eq('user_id', userId);
  if (statuses?.length) query = query.in('status', statuses);
  const from = (safePage - 1) * safePageSize;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + safePageSize - 1);
  if (error) throw error;
  return { orders: (data || []).map(mapSalesOrderFromDb), totalCount: count || 0 };
};

export interface SalesOrderTodoSummary {
  shipment: number;
  authentication: number;
  settlement: number;
  exception: number;
}

const countStatuses = async (userId: string, statuses: SalesOrderStatus[]): Promise<number> => {
  const { error, count } = await supabase
    .from('sales_orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', statuses);
  if (error) throw error;
  if (!Number.isInteger(count) || (count ?? -1) < 0) throw new Error('销售订单待办统计返回无效');
  return count!;
};

export const getSalesOrderTodoSummary = async (userId: string): Promise<SalesOrderTodoSummary> => {
  const [shipment, authentication, settlement, exception] = await Promise.all([
    countStatuses(userId, ['pending_shipment']),
    countStatuses(userId, ['shipped', 'authenticating']),
    countStatuses(userId, ['authenticated']),
    countStatuses(userId, ['auth_failed', 'returning', 'returned']),
  ]);
  return { shipment, authentication, settlement, exception };
};

export const transitionSalesOrder = async (
  userId: string,
  order: SalesOrder,
  action: SalesOrderAction,
  operationId: string,
) => {
  if (!operationId || operationId.length < 8) throw new Error('订单操作号无效，请重新打开订单。');
  const { data, error } = await supabase.rpc('transition_sales_order', {
    p_action: action,
    p_expected_status: order.status,
    p_expected_version: order.version,
    p_operation_id: operationId,
    p_order_id: order.id,
    p_user_id: userId,
  });
  if (error) throw error;
  return data;
};
