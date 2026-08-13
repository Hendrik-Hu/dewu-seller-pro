import { supabase } from '../lib/supabase';
import { buildLedgerBackupPackage, LedgerBackupPackage } from '../lib/ledgerBackup';
import { fetchAllPages } from './pagination';

const safeText = (value: unknown) => value == null ? '' : String(value);
const safeNumber = (value: unknown) => value == null ? null : Number(value);

export const createFullLedgerBackup = async (userId: string): Promise<LedgerBackupPackage> => {
  const [products, activities, warehouses, repairs, feeSchemes, settlements, inventoryAdjustments, salesOrders, salesOrderEvents] = await Promise.all([
    fetchAllPages((from, to) => supabase.from('products')
      .select('id,name,brand,size,sku,price,stock,status,location,warehouse,source,created_at,deleted_at', { count: 'exact' })
      .eq('user_id', userId).order('created_at').order('id').range(from, to), { getKey: (row: any) => String(row.id), label: '商品账本' }),
    fetchAllPages((from, to) => supabase.from('activities')
      .select('id,type,product_name,sku,size,price,cost,count,warehouse,platform,source,created_at,fee_snapshot,estimated_platform_fee,estimated_net_proceeds,estimated_net_profit,actual_platform_fee,actual_net_proceeds,actual_net_profit,settled_at,settlement_order_no,settlement_note,settlement_revision', { count: 'exact' })
      .eq('user_id', userId).order('created_at').order('id').range(from, to), { getKey: (row: any) => String(row.id), label: '库存流水' }),
    fetchAllPages((from, to) => supabase.from('warehouses')
      .select('id,name,is_default,created_at', { count: 'exact' })
      .eq('user_id', userId).order('created_at').order('id').range(from, to), { getKey: (row: any) => String(row.id), label: '仓库' }),
    fetchAllPages((from, to) => supabase.from('data_repair_audit')
      .select('id,target_table,record_id,field_name,old_value,new_value,old_status,new_status,reason,created_at', { count: 'exact' })
      .eq('user_id', userId).order('created_at').order('id').range(from, to), { getKey: (row: any) => String(row.id), label: '数据修复审计' }),
    fetchAllPages((from, to) => supabase.from('fee_schemes')
      .select('id,name,sale_mode,category,percent_rate,percent_min,percent_max,percentage_unit,fixed_fee,fixed_fee_unit,shipping_fee,shipping_fee_unit,other_fee,other_fee_unit,effective_from,is_default,created_at,updated_at', { count: 'exact' })
      .eq('user_id', userId).order('created_at').order('id').range(from, to), { getKey: (row: any) => String(row.id), label: '费用方案' }),
    fetchAllPages((from, to) => supabase.from('outbound_settlement_audit')
      .select('id,activity_id,revision,previous_snapshot,settlement_snapshot,created_at', { count: 'exact' })
      .eq('user_id', userId).order('created_at').order('id').range(from, to), { getKey: (row: any) => String(row.id), label: '结算审计' }),
    fetchAllPages((from, to) => supabase.from('inventory_adjustment_audit')
      .select('id,operation_id,product_id,sku,size,warehouse,old_stock,new_stock,old_cost,new_cost,old_status,new_status,reason,created_at', { count: 'exact' })
      .eq('user_id', userId).order('created_at').order('id').range(from, to), { getKey: (row: any) => String(row.id), label: '盘点调整审计' }),
    fetchAllPages((from, to) => supabase.from('sales_orders')
      .select('id,product_id,status,product_name,brand,sku,size,warehouse,quantity,unit_sale_price,frozen_unit_cost,platform,external_order_no,note,fee_snapshot,estimated_platform_fee,estimated_net_proceeds,estimated_net_profit,outbound_activity_id,inventory_restored,version,created_at,updated_at,shipped_at,authentication_started_at,authenticated_at,settled_at,canceled_at,return_started_at,returned_at,refunded_at', { count: 'exact' })
      .eq('user_id', userId).order('created_at').order('id').range(from, to), { getKey: (row: any) => String(row.id), label: '销售订单' }),
    fetchAllPages((from, to) => supabase.from('sales_order_events')
      .select('id,order_id,operation_id,payload_fingerprint,action,from_status,to_status,details,result,created_at', { count: 'exact' })
      .eq('user_id', userId).order('created_at').order('id').range(from, to), { getKey: (row: any) => String(row.id), label: '销售订单事件' }),
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
      feeSnapshot: row.fee_snapshot ?? null, estimatedPlatformFee: safeNumber(row.estimated_platform_fee),
      estimatedNetProceeds: safeNumber(row.estimated_net_proceeds), estimatedNetProfit: safeNumber(row.estimated_net_profit),
      actualPlatformFee: safeNumber(row.actual_platform_fee), actualNetProceeds: safeNumber(row.actual_net_proceeds), actualNetProfit: safeNumber(row.actual_net_profit),
      settledAt: row.settled_at == null ? null : safeText(row.settled_at), settlementOrderNo: safeText(row.settlement_order_no),
      settlementNote: safeText(row.settlement_note), settlementRevision: safeNumber(row.settlement_revision),
    })),
    warehouses: warehouses.map((row: any) => ({
      sourceId: safeText(row.id), name: safeText(row.name), isDefault: Boolean(row.is_default), createdAt: safeText(row.created_at),
    })),
    repairs: repairs.map((row: any) => ({
      sourceId: safeText(row.id), targetTable: safeText(row.target_table), recordId: safeText(row.record_id), fieldName: safeText(row.field_name),
      oldValue: safeNumber(row.old_value), newValue: safeNumber(row.new_value), oldStatus: row.old_status == null ? null : safeText(row.old_status),
      newStatus: row.new_status == null ? null : safeText(row.new_status), reason: safeText(row.reason), createdAt: safeText(row.created_at),
    })),
    feeSchemes: feeSchemes.map((row: any) => ({
      sourceId: safeText(row.id), name: safeText(row.name), saleMode: safeText(row.sale_mode), category: safeText(row.category),
      percentRate: safeNumber(row.percent_rate), percentMin: safeNumber(row.percent_min), percentMax: safeNumber(row.percent_max),
      percentageUnit: safeText(row.percentage_unit), fixedFee: safeNumber(row.fixed_fee), fixedFeeUnit: safeText(row.fixed_fee_unit),
      shippingFee: safeNumber(row.shipping_fee), shippingFeeUnit: safeText(row.shipping_fee_unit), otherFee: safeNumber(row.other_fee),
      otherFeeUnit: safeText(row.other_fee_unit), effectiveFrom: safeText(row.effective_from), isDefault: Boolean(row.is_default),
      createdAt: safeText(row.created_at), updatedAt: safeText(row.updated_at),
    })),
    settlements: settlements.map((row: any) => ({ sourceId: safeText(row.id), activitySourceId: safeText(row.activity_id), revision: safeNumber(row.revision), previousSnapshot: row.previous_snapshot ?? null, settlementSnapshot: row.settlement_snapshot ?? {}, createdAt: safeText(row.created_at) })),
    inventoryAdjustments: inventoryAdjustments.map((row: any) => ({
      sourceId: safeText(row.id), operationId: safeText(row.operation_id), productSourceId: safeText(row.product_id),
      sku: safeText(row.sku), size: safeText(row.size), warehouse: safeText(row.warehouse),
      oldStock: safeNumber(row.old_stock), newStock: safeNumber(row.new_stock), oldCost: safeNumber(row.old_cost), newCost: safeNumber(row.new_cost),
      oldStatus: safeText(row.old_status), newStatus: safeText(row.new_status), reason: safeText(row.reason), createdAt: safeText(row.created_at),
    })),
    salesOrders: salesOrders.map((row: any) => ({
      sourceId: safeText(row.id), productSourceId: safeText(row.product_id), status: safeText(row.status),
      productName: safeText(row.product_name), brand: safeText(row.brand), sku: safeText(row.sku), size: safeText(row.size), warehouse: safeText(row.warehouse),
      quantity: safeNumber(row.quantity), unitSalePrice: safeNumber(row.unit_sale_price), frozenUnitCost: safeNumber(row.frozen_unit_cost),
      platform: safeText(row.platform), externalOrderNo: safeText(row.external_order_no), note: safeText(row.note), feeSnapshot: row.fee_snapshot ?? {},
      estimatedPlatformFee: safeNumber(row.estimated_platform_fee), estimatedNetProceeds: safeNumber(row.estimated_net_proceeds), estimatedNetProfit: safeNumber(row.estimated_net_profit),
      outboundActivitySourceId: safeText(row.outbound_activity_id), inventoryRestored: Boolean(row.inventory_restored), version: safeNumber(row.version),
      createdAt: safeText(row.created_at), updatedAt: safeText(row.updated_at), shippedAt: row.shipped_at == null ? null : safeText(row.shipped_at),
      authenticationStartedAt: row.authentication_started_at == null ? null : safeText(row.authentication_started_at), authenticatedAt: row.authenticated_at == null ? null : safeText(row.authenticated_at),
      settledAt: row.settled_at == null ? null : safeText(row.settled_at), canceledAt: row.canceled_at == null ? null : safeText(row.canceled_at),
      returnStartedAt: row.return_started_at == null ? null : safeText(row.return_started_at), returnedAt: row.returned_at == null ? null : safeText(row.returned_at),
      refundedAt: row.refunded_at == null ? null : safeText(row.refunded_at),
    })),
    salesOrderEvents: salesOrderEvents.map((row: any) => ({
      sourceId: safeText(row.id), orderSourceId: safeText(row.order_id), operationId: safeText(row.operation_id),
      payloadFingerprint: safeText(row.payload_fingerprint), action: safeText(row.action), fromStatus: row.from_status == null ? null : safeText(row.from_status),
      toStatus: safeText(row.to_status), details: row.details ?? {}, result: row.result ?? {}, createdAt: safeText(row.created_at),
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
