import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ChevronRight, Loader2, PackageCheck, RefreshCw, X } from 'lucide-react';
import { SALES_ORDER_ACTION_LABELS, SALES_ORDER_STATUS_LABELS, getSalesOrderTransitions, type SalesOrderAction } from '../lib/salesOrderLifecycle';
import { listSalesOrders, transitionSalesOrder } from '../services/salesOrders';
import type { SalesOrder, SalesOrderStatus } from '../types';

interface SalesOrdersModalProps {
  userId: string;
  onClose: () => void;
  onChanged?: () => void;
}

type QueueKey = 'active' | 'shipment' | 'authentication' | 'settlement' | 'exception';

const queueStatuses: Record<QueueKey, SalesOrderStatus[]> = {
  active: ['pending_shipment', 'shipped', 'authenticating', 'authenticated', 'auth_failed', 'returning', 'returned'],
  shipment: ['pending_shipment'],
  authentication: ['shipped', 'authenticating'],
  settlement: ['authenticated'],
  exception: ['auth_failed', 'returning', 'returned'],
};

const queueLabels: Record<QueueKey, string> = {
  active: '全部待办', shipment: '待发货', authentication: '鉴别', settlement: '待结算', exception: '异常',
};

const createOperationId = () => globalThis.crypto?.randomUUID?.() || `sales-order-${Date.now()}`;

export const SalesOrdersModal: React.FC<SalesOrdersModalProps> = ({ userId, onClose, onChanged }) => {
  const [queue, setQueue] = useState<QueueKey>('active');
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<SalesOrder | null>(null);
  const [pendingAction, setPendingAction] = useState<SalesOrderAction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const latestRequest = useRef(0);

  useEffect(() => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError('');
    listSalesOrders(userId, queueStatuses[queue], 1, 50).then((result) => {
      if (requestId !== latestRequest.current) return;
      setOrders(result.orders);
      setSelected((current) => current ? result.orders.find((item) => item.id === current.id) || null : null);
    }).catch((reason) => {
      if (requestId !== latestRequest.current) return;
      setError(reason instanceof Error ? reason.message : '销售订单加载失败');
    }).finally(() => {
      if (requestId === latestRequest.current) setLoading(false);
    });
  }, [queue, retry, userId]);

  const transitions = useMemo(() => selected ? getSalesOrderTransitions(selected.status, {
    inventoryRestored: selected.inventoryRestored,
    outboundActivityId: selected.outboundActivityId,
    hasSettlement: selected.status === 'settled' || selected.status === 'returning' || selected.status === 'returned' || selected.status === 'refunded',
  }) : [], [selected]);

  const submitAction = async () => {
    if (!selected || !pendingAction) return;
    setSubmitting(true);
    setActionError('');
    try {
      await transitionSalesOrder(userId, selected, pendingAction, createOperationId());
      setPendingAction(null);
      setRetry((value) => value + 1);
      onChanged?.();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '订单操作失败，请刷新后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-task-shell animate-[fadeIn_0.2s_ease-out]">
      <div className="app-task-panel">
        <div className="app-task-header">
          <div className="flex min-w-0 items-center gap-2">
            {selected && <button type="button" className="app-icon-button border-0 bg-transparent" onClick={() => { setSelected(null); setPendingAction(null); }} aria-label="返回销售订单列表"><ArrowLeft size={20} /></button>}
            <div><h2 className="text-lg font-bold text-slate-900 dark:text-white">{selected ? '销售订单详情' : '销售订单'}</h2><p className="text-xs text-slate-500 dark:text-zinc-400">预留、发货、鉴别、退回与结算</p></div>
          </div>
          <button type="button" onClick={onClose} className="app-icon-button border-0 bg-transparent" aria-label="关闭销售订单"><X size={20} /></button>
        </div>

        {!selected ? <>
          <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-4 py-3 dark:border-zinc-800">
            {(Object.keys(queueLabels) as QueueKey[]).map((key) => <button type="button" key={key} onClick={() => setQueue(key)} className={`app-touch shrink-0 rounded-lg px-3 text-xs font-semibold ${queue === key ? 'bg-slate-900 text-white dark:bg-white dark:text-zinc-950' : 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>{queueLabels[key]}</button>)}
          </div>
          <div className="app-task-body p-0">
            {loading && <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"><Loader2 size={18} className="animate-spin" />正在同步销售订单</div>}
            {!loading && error && <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-center text-sm text-rose-600"><p>订单同步失败，没有用空数据替代。</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="app-secondary-action mt-3"><RefreshCw size={16} />重试</button></div>}
            {!loading && !error && orders.length === 0 && <div className="flex flex-col items-center justify-center py-20 text-slate-400"><PackageCheck size={36} className="mb-3 opacity-40" /><p className="text-sm">当前没有{queueLabels[queue]}订单</p></div>}
            {!loading && !error && orders.map((order) => <button type="button" key={order.id} onClick={() => setSelected(order)} className="app-touch flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left dark:border-zinc-800">
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="rounded bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700 dark:bg-teal-950/30 dark:text-teal-300">{SALES_ORDER_STATUS_LABELS[order.status]}</span><span className="truncate text-xs text-slate-400">{order.warehouse}</span></div><h3 className="mt-2 truncate text-sm font-semibold text-slate-900 dark:text-white">{order.productName}</h3><p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">{order.sku} · {order.size} · x{order.quantity}</p></div>
              <div className="shrink-0 text-right"><p className="text-base font-bold text-slate-900 dark:text-white">¥{(order.unitSalePrice * order.quantity).toFixed(2)}</p><ChevronRight size={18} className="ml-auto mt-2 text-slate-300" /></div>
            </button>)}
          </div>
        </> : <div className="app-task-body space-y-4">
          <section className="app-surface p-4"><div className="flex items-center justify-between"><span className="rounded bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700">{SALES_ORDER_STATUS_LABELS[selected.status]}</span><span className="text-xs text-slate-400">版本 {selected.version}</span></div><h3 className="mt-3 text-base font-bold text-slate-900 dark:text-white">{selected.productName}</h3><p className="mt-1 text-sm text-slate-500">{selected.brand} · {selected.sku} · {selected.size}</p><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-slate-400">仓库</p><p className="mt-1 font-semibold">{selected.warehouse}</p></div><div><p className="text-xs text-slate-400">数量</p><p className="mt-1 font-semibold">{selected.quantity} 件</p></div><div><p className="text-xs text-slate-400">成交额</p><p className="mt-1 font-semibold">¥{(selected.unitSalePrice * selected.quantity).toFixed(2)}</p></div><div><p className="text-xs text-slate-400">冻结成本</p><p className="mt-1 font-semibold">¥{(selected.frozenUnitCost * selected.quantity).toFixed(2)}</p></div></div></section>
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-300">库存已在建单时预留；确认发货只写出库流水，不会再次扣库存。取消或确认实物退回才恢复一次。</div>
          {selected.status === 'authenticated' && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700"><strong>待补录结算：</strong>先在出库流水中填写实际费用与到手，之后才能完成订单结算。</div>}
          {actionError && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{actionError}</div>}
          <div className="space-y-2">{transitions.filter((item) => item.action !== 'settle').map((item) => <button type="button" key={item.action} onClick={() => setPendingAction(item.action)} className="app-secondary-action w-full justify-between"><span>{SALES_ORDER_ACTION_LABELS[item.action]}</span><ChevronRight size={17} /></button>)}</div>
        </div>}

        {selected && pendingAction && <div className="absolute inset-0 z-30 flex items-end bg-slate-950/45 p-4"><div className="w-full rounded-xl bg-white p-4 shadow-xl dark:bg-zinc-900"><div className="flex items-start gap-3"><AlertTriangle size={22} className="mt-0.5 shrink-0 text-amber-500" /><div><h3 className="font-bold">确认{SALES_ORDER_ACTION_LABELS[pendingAction]}</h3><p className="mt-1 text-xs leading-5 text-slate-500">当前状态：{SALES_ORDER_STATUS_LABELS[selected.status]}。涉及库存恢复或出库流水的动作会在一个事务中完成，同一操作不会重复记账。</p></div></div><div className="mt-4 grid grid-cols-2 gap-3"><button type="button" disabled={submitting} onClick={() => setPendingAction(null)} className="app-secondary-action">返回</button><button type="button" disabled={submitting} onClick={submitAction} className="app-primary-action">{submitting ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}确认记账</button></div></div></div>}
      </div>
    </div>
  );
};
