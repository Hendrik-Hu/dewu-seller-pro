import { supabase } from '../lib/supabase';

export interface DataHealthIssue {
  table: 'products' | 'activities';
  id: string;
  sku: string;
  size: string;
  warehouse: string;
  value: number;
  createdAt: string;
  suggestion: string;
  productName: string;
  status?: 'instock' | 'shipping' | 'sold' | 'flaw';
  activityType?: string;
  price?: number;
  cost?: number;
  issueType: 'negative_stock' | 'nonpositive_activity' | 'orphan_warehouse';
}

export interface DataRepairAudit {
  id: string;
  targetTable: string;
  recordId: string;
  oldValue: number;
  newValue: number;
  reason: string;
  createdAt: string;
  oldStatus?: string;
  newStatus?: string;
  fieldName: string;
  isWarehouseRepair: boolean;
}

const mapDataRepairAudit = (row: any): DataRepairAudit => ({
  id: String(row.id),
  targetTable: String(row.target_table),
  recordId: String(row.record_id),
  oldValue: Number(row.old_value),
  newValue: Number(row.new_value),
  reason: String(row.reason),
  createdAt: String(row.created_at),
  oldStatus: row.old_status == null ? undefined : String(row.old_status),
  newStatus: row.new_status == null ? undefined : String(row.new_status),
  fieldName: String(row.field_name),
  isWarehouseRepair: String(row.reason || '').startsWith('仓库修复：'),
});

export const listOrphanWarehouseProducts = async () => {
  const { data, error } = await supabase.rpc('list_orphan_warehouse_products');
  if (error) throw error;
  return data || [];
};

export const countOrphanWarehouseProducts = async () => {
  const { data, error } = await supabase.rpc('count_orphan_warehouse_products');
  if (error) throw error;
  return Number(data || 0);
};

export const listDataHealthIssues = async (userId: string): Promise<DataHealthIssue[]> => {
  const [productsResult, activitiesResult, orphanResult] = await Promise.all([
    supabase.from('products').select('id,name,sku,size,warehouse,stock,status,created_at').eq('user_id', userId).lt('stock', 0).order('created_at'),
    supabase.from('activities').select('id,product_name,type,sku,size,warehouse,count,price,cost,created_at').eq('user_id', userId).lte('count', 0).order('created_at'),
    listOrphanWarehouseProducts(),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (activitiesResult.error) throw activitiesResult.error;

  return [
    ...(productsResult.data || []).map((row) => ({
      table: 'products' as const,
      id: String(row.id),
      sku: String(row.sku || ''),
      size: String(row.size || '均码'),
      warehouse: String(row.warehouse || '未设置仓库'),
      value: Number(row.stock),
      createdAt: String(row.created_at || ''),
      suggestion: '核对实物库存后填写当前实际数量',
      productName: String(row.name || ''),
      status: row.status as DataHealthIssue['status'],
      issueType: 'negative_stock' as const,
    })),
    ...(activitiesResult.data || []).map((row) => ({
      table: 'activities' as const,
      id: String(row.id),
      sku: String(row.sku || ''),
      size: String(row.size || '均码'),
      warehouse: String(row.warehouse || '未设置仓库'),
      value: Number(row.count),
      createdAt: String(row.created_at || ''),
      suggestion: '核对原始入出库凭证后填写正确数量',
      productName: String(row.product_name || ''),
      activityType: String(row.type || ''),
      price: row.price == null ? undefined : Number(row.price),
      cost: row.cost == null ? undefined : Number(row.cost),
      issueType: 'nonpositive_activity' as const,
    })),
    ...(orphanResult || []).map((row: any) => ({
      table: 'products' as const,
      id: String(row.id),
      sku: String(row.sku || ''),
      size: String(row.size || '均码'),
      warehouse: String(row.warehouse || '未设置仓库'),
      value: Number(row.stock),
      createdAt: String(row.created_at || ''),
      suggestion: '选择一个现有仓库；系统不会自动移动这条库存',
      productName: String(row.name || ''),
      status: row.status as DataHealthIssue['status'],
      issueType: 'orphan_warehouse' as const,
    })),
  ];
};

export const listDataRepairAudit = async (userId: string): Promise<DataRepairAudit[]> => {
  const { data, error } = await supabase
    .from('data_repair_audit')
    .select('id,target_table,record_id,field_name,old_value,new_value,reason,old_status,new_status,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data || []).map(mapDataRepairAudit);
};

export const listDataRepairAuditPage = async (userId: string, page = 1, pageSize = 30) => {
  const from = (page - 1) * pageSize;
  const { data, error, count } = await supabase
    .from('data_repair_audit')
    .select('id,target_table,record_id,field_name,old_value,new_value,reason,old_status,new_status,created_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw error;
  return { repairs: (data || []).map(mapDataRepairAudit), totalCount: count || 0 };
};

export const repairOrphanProductWarehouse = async (
  userId: string,
  productId: string,
  targetWarehouseId: string,
  reason: string,
) => {
  const { data, error } = await supabase.rpc('repair_orphan_product_warehouse', {
    p_user_id: userId,
    p_product_id: productId,
    p_target_warehouse_id: targetWarehouseId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
};

export const repairDataHealthIssue = async (
  userId: string,
  issue: DataHealthIssue,
  newValue: number,
  reason: string,
  targetStatus?: DataHealthIssue['status'],
) => {
  const { data, error } = await supabase.rpc('repair_inventory_anomaly', {
    p_user_id: userId,
    p_target_table: issue.table,
    p_record_id: issue.id,
    p_new_value: newValue,
    p_reason: reason,
    p_target_status: targetStatus || null,
  });
  if (error) throw error;
  return data;
};
