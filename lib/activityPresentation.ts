import type { Activity } from '../types';

export const ACTIVITY_TYPE_LABELS: Record<Activity['type'], string> = {
  inbound: '入库',
  outbound: '出库',
  pending: '待发货',
  restore: '恢复',
  transfer: '调拨',
};

export const getActivityTypeLabel = (type: Activity['type']) => ACTIVITY_TYPE_LABELS[type] || type;
