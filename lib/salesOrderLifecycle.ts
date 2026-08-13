import type { SalesOrderStatus } from '../types.ts';

export type SalesOrderAction =
  | 'ship'
  | 'start_authentication'
  | 'pass_authentication'
  | 'fail_authentication'
  | 'settle'
  | 'cancel'
  | 'start_return'
  | 'confirm_return'
  | 'complete_refund';

export type SalesOrderInventoryEffect = 'none' | 'write_outbound' | 'restore_inventory';

export interface SalesOrderTransitionContext {
  hasSettlement?: boolean;
  inventoryRestored?: boolean;
  outboundActivityId?: string;
}

export interface SalesOrderTransition {
  action: SalesOrderAction;
  from: SalesOrderStatus;
  to: SalesOrderStatus;
  inventoryEffect: SalesOrderInventoryEffect;
}

export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  pending_shipment: '待发货',
  shipped: '已发货',
  authenticating: '鉴别中',
  authenticated: '鉴别通过',
  settled: '已结算',
  canceled: '已取消',
  auth_failed: '鉴别失败',
  returning: '退回中',
  returned: '已退回',
  refunded: '已退款',
};

export const SALES_ORDER_ACTION_LABELS: Record<SalesOrderAction, string> = {
  ship: '确认发货',
  start_authentication: '开始鉴别',
  pass_authentication: '确认鉴别通过',
  fail_authentication: '标记鉴别失败',
  settle: '补录结算',
  cancel: '取消订单',
  start_return: '开始退回',
  confirm_return: '确认退回入库',
  complete_refund: '确认退款完成',
};

const transition = (
  action: SalesOrderAction,
  from: SalesOrderStatus,
  to: SalesOrderStatus,
  inventoryEffect: SalesOrderInventoryEffect = 'none',
): SalesOrderTransition => ({ action, from, to, inventoryEffect });

const TRANSITIONS: Record<SalesOrderStatus, SalesOrderTransition[]> = {
  pending_shipment: [
    transition('ship', 'pending_shipment', 'shipped', 'write_outbound'),
    transition('cancel', 'pending_shipment', 'canceled', 'restore_inventory'),
  ],
  shipped: [
    transition('start_authentication', 'shipped', 'authenticating'),
    transition('pass_authentication', 'shipped', 'authenticated'),
  ],
  authenticating: [
    transition('pass_authentication', 'authenticating', 'authenticated'),
    transition('fail_authentication', 'authenticating', 'auth_failed'),
  ],
  authenticated: [transition('settle', 'authenticated', 'settled')],
  settled: [transition('start_return', 'settled', 'returning')],
  auth_failed: [transition('start_return', 'auth_failed', 'returning')],
  returning: [transition('confirm_return', 'returning', 'returned', 'restore_inventory')],
  returned: [transition('complete_refund', 'returned', 'refunded')],
  canceled: [],
  refunded: [],
};

export const getSalesOrderTransitions = (
  status: SalesOrderStatus,
  context: SalesOrderTransitionContext = {},
): SalesOrderTransition[] => TRANSITIONS[status].filter((item) => {
  if (item.inventoryEffect === 'restore_inventory' && context.inventoryRestored) return false;
  if (item.action === 'ship' && context.outboundActivityId) return false;
  if (item.action === 'complete_refund' && !context.hasSettlement) return false;
  return true;
});

export const resolveSalesOrderTransition = (
  status: SalesOrderStatus,
  action: SalesOrderAction,
  context: SalesOrderTransitionContext = {},
): SalesOrderTransition => {
  const match = getSalesOrderTransitions(status, context).find((item) => item.action === action);
  if (!match) throw new Error(`订单当前为“${SALES_ORDER_STATUS_LABELS[status]}”，不能执行“${SALES_ORDER_ACTION_LABELS[action]}”`);
  return match;
};

export const isSalesOrderTerminal = (status: SalesOrderStatus, hasSettlement = false): boolean => (
  status === 'canceled'
  || status === 'refunded'
  || (status === 'returned' && !hasSettlement)
);

export const getSalesOrderTodoGroup = (status: SalesOrderStatus): 'shipment' | 'authentication' | 'settlement' | 'exception' | 'done' => {
  if (status === 'pending_shipment') return 'shipment';
  if (status === 'shipped' || status === 'authenticating') return 'authentication';
  if (status === 'authenticated') return 'settlement';
  if (status === 'auth_failed' || status === 'returning' || status === 'returned') return 'exception';
  return 'done';
};
