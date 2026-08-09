import { supabase } from '../lib/supabase';
import { buildLedgerBackupPackage, LedgerBackupPackage } from '../lib/ledgerBackup';
import { fetchAllPages } from './pagination';

const safeText = (value: unknown) => value == null ? '' : String(value);
const safeNumber = (value: unknown) => value == null ? null : Number(value);

export const createFullLedgerBackup = async (userId: string): Promise<LedgerBackupPackage> => {
  const [products, activities, warehouses, repairs] = await Promise.all([
    fetchAllPages((from, to) => supabase.from('products')
      .select('id,name,brand,size,sku,price,stock,status,location,warehouse,source,created_at,deleted_at', { count: 'exact' })
      .eq('user_id', userId).order('created_at').order('id').range(from, to), { getKey: (row: any) => String(row.id), label: '商品账本' }),
    fetchAllPages((from, to) => supabase.from('activities')
      .select('id,type,product_name,sku,size,price,cost,count,warehouse,platform,source,created_at', { count: 'exact' })
      .eq('user_id', userId).order('created_at').order('id').range(from, to), { getKey: (row: any) => String(row.id), label: '库存流水' }),
    fetchAllPages((from, to) => supabase.from('warehouses')
      .select('id,name,is_default,created_at', { count: 'exact' })
      .eq('user_id', userId).order('created_at').order('id').range(from, to), { getKey: (row: any) => String(row.id), label: '仓库' }),
    fetchAllPages((from, to) => supabase.from('data_repair_audit')
      .select('id,target_table,record_id,field_name,old_value,new_value,old_status,new_status,reason,created_at', { count: 'exact' })
      .eq('user_id', userId).order('created_at').order('id').range(from, to), { getKey: (row: any) => String(row.id), label: '数据修复审计' }),
  ]);

  return buildLedgerBackupPackage({
    products: products.map((row: any) => ({
      sourceId: safeText(row.id), name: safeText(row.name), brand: safeText(row.brand), size: safeText(row.size),
      sku: safeText(row.sku), cost: safeNumber(row.price), stock: safeNumber(row.stock), status: safeText(row.status),
      location: safeText(row.location), warehouse: safeText(row.warehouse), source: safeText(row.source),
      createdAt: safeText(row.created_at), deletedAt: row.deleted_at == null ? null : safeText(row.deleted_at),
    })),
    activities: activities.map((row: any) => ({
      sourceId: safeText(row.id), type: safeText(row.type), productName: safeText(row.product_name), sku: safeText(row.sku),
      size: safeText(row.size), price: safeNumber(row.price), cost: safeNumber(row.cost), count: safeNumber(row.count),
      warehouse: safeText(row.warehouse), platform: safeText(row.platform), source: safeText(row.source), createdAt: safeText(row.created_at),
    })),
    warehouses: warehouses.map((row: any) => ({
      sourceId: safeText(row.id), name: safeText(row.name), isDefault: Boolean(row.is_default), createdAt: safeText(row.created_at),
    })),
    repairs: repairs.map((row: any) => ({
      sourceId: safeText(row.id), targetTable: safeText(row.target_table), recordId: safeText(row.record_id), fieldName: safeText(row.field_name),
      oldValue: safeNumber(row.old_value), newValue: safeNumber(row.new_value), oldStatus: row.old_status == null ? null : safeText(row.old_status),
      newStatus: row.new_status == null ? null : safeText(row.new_status), reason: safeText(row.reason), createdAt: safeText(row.created_at),
    })),
  });
};

export interface LedgerRestoreResult {
  dryRun: boolean;
  operationId?: string;
  packageHash: string;
  payloadFingerprint: string;
  added: number;
  merged: number;
  conflicts: number;
  skipped: number;
  details: Array<{ entity: string; sourceId: string; outcome: string; reason?: string }>;
  detailsTruncated: boolean;
}

export const previewLedgerRestore = async (userId: string, backup: LedgerBackupPackage): Promise<LedgerRestoreResult> => {
  const { data, error } = await supabase.rpc('restore_ledger_backup', {
    p_dry_run: true,
    p_operation_id: `preview-${crypto.randomUUID()}`,
    p_package: backup,
    p_user_id: userId,
  });
  if (error) throw error;
  return data as LedgerRestoreResult;
};

export const executeLedgerRestore = async (userId: string, operationId: string, backup: LedgerBackupPackage): Promise<LedgerRestoreResult> => {
  const { data, error } = await supabase.rpc('restore_ledger_backup', {
    p_dry_run: false,
    p_operation_id: operationId,
    p_package: backup,
    p_user_id: userId,
  });
  if (error) throw error;
  return data as LedgerRestoreResult;
};
