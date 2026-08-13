import type { SalesOrder, SalesOrderEvent, SalesOrderStatus } from '../types.ts';

const salesOrderStatuses = new Set<SalesOrderStatus>([
  'pending_shipment', 'shipped', 'authenticating', 'authenticated', 'settled',
  'canceled', 'auth_failed', 'returning', 'returned', 'refunded',
]);

const requiredString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`销售订单返回缺少 ${key}`);
  return value;
};

const finiteNumber = (row: Record<string, unknown>, key: string, optional = false): number | undefined => {
  const raw = row[key];
  if (optional && raw == null) return undefined;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) throw new Error(`销售订单返回的 ${key} 无效`);
  return value;
};

export const mapSalesOrderFromDb = (raw: unknown): SalesOrder => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('销售订单返回了无效数据');
  const row = raw as Record<string, unknown>;
  const status = requiredString(row, 'status') as SalesOrderStatus;
  if (!salesOrderStatuses.has(status)) throw new Error('销售订单返回了未知状态');
  const quantity = finiteNumber(row, 'quantity')!;
  const version = finiteNumber(row, 'version')!;
  const unitSalePrice = finiteNumber(row, 'unit_sale_price')!;
  const frozenUnitCost = finiteNumber(row, 'frozen_unit_cost')!;
  if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isInteger(version) || version <= 0) {
    throw new Error('销售订单返回了无效数量或版本');
  }
  if (unitSalePrice < 0 || frozenUnitCost < 0) throw new Error('销售订单返回了无效金额');
  const feeSnapshot = row.fee_snapshot;
  if (!feeSnapshot || typeof feeSnapshot !== 'object' || Array.isArray(feeSnapshot)) throw new Error('销售订单费用快照无效');
  return {
    id: requiredString(row, 'id'), status, productId: requiredString(row, 'product_id'),
    productName: requiredString(row, 'product_name'), brand: requiredString(row, 'brand'),
    sku: requiredString(row, 'sku'), size: requiredString(row, 'size'), warehouse: requiredString(row, 'warehouse'),
    quantity, unitSalePrice, frozenUnitCost,
    platform: requiredString(row, 'platform'), externalOrderNo: typeof row.external_order_no === 'string' ? row.external_order_no : undefined,
    note: typeof row.note === 'string' ? row.note : undefined, feeSnapshot: feeSnapshot as Record<string, unknown>,
    estimatedPlatformFee: finiteNumber(row, 'estimated_platform_fee', true),
    estimatedNetProceeds: finiteNumber(row, 'estimated_net_proceeds', true),
    estimatedNetProfit: finiteNumber(row, 'estimated_net_profit', true),
    outboundActivityId: typeof row.outbound_activity_id === 'string' ? row.outbound_activity_id : undefined,
    inventoryRestored: row.inventory_restored === true, version,
    createdAt: requiredString(row, 'created_at'), updatedAt: requiredString(row, 'updated_at'),
  };
};

const salesOrderEventActions = new Set<SalesOrderEvent['action']>([
  'create', 'ship', 'start_authentication', 'pass_authentication', 'fail_authentication',
  'settle', 'cancel', 'start_return', 'confirm_return', 'complete_refund',
]);

export const mapSalesOrderEventFromDb = (raw: unknown): SalesOrderEvent => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('销售订单事件返回了无效数据');
  const row = raw as Record<string, unknown>;
  const action = requiredString(row, 'action') as SalesOrderEvent['action'];
  const toStatus = requiredString(row, 'to_status') as SalesOrderStatus;
  const fromStatus = typeof row.from_status === 'string' && row.from_status.trim()
    ? row.from_status as SalesOrderStatus
    : undefined;
  if (!salesOrderEventActions.has(action)) throw new Error('销售订单事件返回了未知动作');
  if (!salesOrderStatuses.has(toStatus) || (fromStatus && !salesOrderStatuses.has(fromStatus))) {
    throw new Error('销售订单事件返回了未知状态');
  }
  const details = row.details;
  const result = row.result;
  if (!details || typeof details !== 'object' || Array.isArray(details)
    || !result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('销售订单事件快照无效');
  }
  return {
    id: requiredString(row, 'id'),
    orderId: requiredString(row, 'order_id'),
    action,
    fromStatus,
    toStatus,
    details: details as Record<string, unknown>,
    result: result as Record<string, unknown>,
    createdAt: requiredString(row, 'created_at'),
  };
};
