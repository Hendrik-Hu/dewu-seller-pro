import { Preferences } from '@capacitor/preferences';
import { supabase } from '../lib/supabase';

export interface InventoryAdjustmentAudit {
  id: string;
  productId: string;
  operationId: string;
  sku: string;
  size: string;
  warehouse: string;
  oldStock: number;
  newStock: number;
  oldCost: number;
  newCost: number;
  oldStatus: 'instock' | 'shipping' | 'sold' | 'flaw';
  newStatus: 'instock' | 'shipping' | 'sold' | 'flaw';
  reason: string;
  createdAt: string;
}

export interface InventoryAdjustmentDraft {
  operationId: string;
  newStock: string;
  newCost: string;
  reason: string;
  submissionState: 'editing' | 'submitted' | 'retryable';
  expectedStock?: number;
  expectedCost?: number;
  expectedStatus?: InventoryAdjustmentAudit['oldStatus'];
}

const getDraftKey = (userId: string, productId: string) =>
  `inventoryAdjustmentDraftV1:${userId}:${productId}`;

export const createInventoryAdjustmentOperationId = () => `adjust-${crypto.randomUUID()}`;

export const loadInventoryAdjustmentDraft = async (userId: string, productId: string) => {
  const { value } = await Preferences.get({ key: getDraftKey(userId, productId) });
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<InventoryAdjustmentDraft>;
    if (!parsed.operationId || typeof parsed.operationId !== 'string') return null;
    return {
      operationId: parsed.operationId,
      newStock: typeof parsed.newStock === 'string' ? parsed.newStock : '',
      newCost: typeof parsed.newCost === 'string' ? parsed.newCost : '',
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      submissionState: parsed.submissionState === 'submitted' || parsed.submissionState === 'retryable'
        ? parsed.submissionState
        : 'editing',
      expectedStock: Number.isFinite(parsed.expectedStock) ? Number(parsed.expectedStock) : undefined,
      expectedCost: Number.isFinite(parsed.expectedCost) ? Number(parsed.expectedCost) : undefined,
      expectedStatus: ['instock', 'shipping', 'sold', 'flaw'].includes(String(parsed.expectedStatus))
        ? parsed.expectedStatus as InventoryAdjustmentAudit['oldStatus']
        : undefined,
    } satisfies InventoryAdjustmentDraft;
  } catch {
    return null;
  }
};

export const saveInventoryAdjustmentDraft = async (
  userId: string,
  productId: string,
  draft: InventoryAdjustmentDraft,
) => Preferences.set({ key: getDraftKey(userId, productId), value: JSON.stringify(draft) });

export const clearInventoryAdjustmentDraft = async (userId: string, productId: string) =>
  Preferences.remove({ key: getDraftKey(userId, productId) });

export const adjustProductInventory = async (params: {
  productId: string;
  operationId: string;
  expectedStock: number;
  expectedCost: number;
  expectedStatus: InventoryAdjustmentAudit['oldStatus'];
  newStock: number;
  newCost: number;
  reason: string;
}) => {
  const { data, error } = await supabase.rpc('adjust_product_inventory', {
    p_expected_cost: params.expectedCost,
    p_expected_status: params.expectedStatus,
    p_expected_stock: params.expectedStock,
    p_new_cost: params.newCost,
    p_new_stock: params.newStock,
    p_operation_id: params.operationId,
    p_product_id: params.productId,
    p_reason: params.reason,
  });
  if (error) throw error;
  return data as {
    auditId: string;
    productId: string;
    oldStock: number;
    newStock: number;
    oldCost: number;
    newCost: number;
    oldStatus: string;
    newStatus: string;
    replayed: boolean;
  };
};

export const findInventoryAdjustmentByOperation = async (
  userId: string,
  operationId: string,
): Promise<InventoryAdjustmentAudit | null> => {
  const { data, error } = await supabase
    .from('inventory_adjustment_audit')
    .select('id,product_id,operation_id,sku,size,warehouse,old_stock,new_stock,old_cost,new_cost,old_status,new_status,reason,created_at')
    .eq('user_id', userId)
    .eq('operation_id', operationId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapInventoryAdjustmentAudit(data) : null;
};

const mapInventoryAdjustmentAudit = (row: any): InventoryAdjustmentAudit => ({
  id: String(row.id), productId: String(row.product_id), operationId: String(row.operation_id),
  sku: String(row.sku || ''), size: String(row.size || ''), warehouse: String(row.warehouse || ''),
  oldStock: Number(row.old_stock), newStock: Number(row.new_stock), oldCost: Number(row.old_cost), newCost: Number(row.new_cost),
  oldStatus: row.old_status, newStatus: row.new_status, reason: String(row.reason || ''), createdAt: String(row.created_at),
});

export const listInventoryAdjustmentAudits = async (
  userId: string,
  productId: string,
  limit = 20,
): Promise<InventoryAdjustmentAudit[]> => {
  const { data, error } = await supabase
    .from('inventory_adjustment_audit')
    .select('id,product_id,operation_id,sku,size,warehouse,old_stock,new_stock,old_cost,new_cost,old_status,new_status,reason,created_at')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapInventoryAdjustmentAudit);
};

export const listInventoryAdjustmentAuditPage = async (params: {
  userId: string;
  search?: string;
  warehouse?: string;
  period?: 'all' | 'month' | '30days';
  page: number;
  pageSize: number;
}) => {
  const from = (params.page - 1) * params.pageSize;
  let query = supabase
    .from('inventory_adjustment_audit')
    .select('id,product_id,operation_id,sku,size,warehouse,old_stock,new_stock,old_cost,new_cost,old_status,new_status,reason,created_at', { count: 'exact' })
    .eq('user_id', params.userId);
  if (params.search?.trim()) query = query.ilike('sku', `%${params.search.trim()}%`);
  if (params.warehouse && params.warehouse !== 'all') query = query.eq('warehouse', params.warehouse);
  if (params.period === 'month') {
    const now = new Date();
    query = query.gte('created_at', new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
  } else if (params.period === '30days') {
    query = query.gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  }
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + params.pageSize - 1);
  if (error) throw error;
  return { audits: (data || []).map(mapInventoryAdjustmentAudit), totalCount: count || 0 };
};
