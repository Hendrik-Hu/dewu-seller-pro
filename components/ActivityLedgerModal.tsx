import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Clock3, History, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { Activity, Warehouse } from '../types';
import { getActivityGrossAmount, getActivityQuantity } from '../lib/inventoryMetrics';
import { formatProductSize } from '../lib/productNormalization';
import { listActivityPage } from '../services/activities';
import { DataRepairAudit, listDataRepairAuditPage } from '../services/dataHealth';
import { ACTIVITY_TYPE_LABELS, getActivityTypeLabel } from '../lib/activityPresentation';

interface ActivityLedgerModalProps {
  isOpen: boolean;
  userId: string;
  warehouses: Warehouse[];
  onClose: () => void;
}

const PAGE_SIZE = 30;
const statusLabels: Record<string, string> = { instock: '在售', shipping: '运输中', sold: '已售罄', flaw: '瑕疵' };

export const ActivityLedgerModal: React.FC<ActivityLedgerModalProps> = ({ isOpen, userId, warehouses, onClose }) => {
  const [view, setView] = useState<'activities' | 'repairs'>('activities');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [repairs, setRepairs] = useState<DataRepairAudit[]>([]);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<Activity['type'] | 'all'>('all');
  const [warehouse, setWarehouse] = useState('all');
  const [period, setPeriod] = useState<'all' | 'month' | '30days'>('all');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(async () => {
      try {
        if (view === 'activities') {
          const result = await listActivityPage({ userId, search, type, warehouse, period, page, pageSize: PAGE_SIZE });
          if (!cancelled) {
            setActivities(result.activities);
            setTotalCount(result.totalCount);
          }
        } else {
          const result = await listDataRepairAuditPage(userId, page, PAGE_SIZE);
          if (!cancelled) {
            setRepairs(result.repairs);
            setTotalCount(result.totalCount);
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || '账本加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, search ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, userId, view, search, type, warehouse, period, page, reloadKey]);

  useEffect(() => setPage(1), [view, search, type, warehouse, period]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="activity-ledger-title" className="flex h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <header className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-zinc-800">
          <div>
            <h2 id="activity-ledger-title" className="font-bold text-slate-900 dark:text-white">活动账本</h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400">库存流水与人工修复记录</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400" aria-label="关闭活动账本"><X size={20} /></button>
        </header>

        <div className="grid grid-cols-2 border-b border-slate-100 px-3 dark:border-zinc-800">
          <button onClick={() => setView('activities')} className={`py-3 text-sm font-medium ${view === 'activities' ? 'border-b-2 border-dewu-500 text-dewu-600' : 'text-slate-400'}`}>库存流水</button>
          <button onClick={() => setView('repairs')} className={`py-3 text-sm font-medium ${view === 'repairs' ? 'border-b-2 border-amber-500 text-amber-600' : 'text-slate-400'}`}>修复记录</button>
        </div>

        {view === 'activities' && (
          <div className="space-y-2 border-b border-slate-100 p-3 dark:border-zinc-800">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-800">
              <Search size={16} className="text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索商品名称或货号" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none dark:text-white" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <select value={type} onChange={(event) => setType(event.target.value as Activity['type'] | 'all')} className="min-w-0 rounded-lg border border-slate-200 bg-white px-1.5 py-2 text-[11px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                <option value="all">全部类型</option>
                {Object.entries(ACTIVITY_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} className="min-w-0 rounded-lg border border-slate-200 bg-white px-1.5 py-2 text-[11px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                <option value="all">全部仓库</option>
                {warehouses.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select>
              <select value={period} onChange={(event) => setPeriod(event.target.value as 'all' | 'month' | '30days')} className="min-w-0 rounded-lg border border-slate-200 bg-white px-1.5 py-2 text-[11px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                <option value="all">全部时间</option><option value="month">本自然月</option><option value="30days">近30天</option>
              </select>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-slate-50 p-3 dark:bg-black/40">
          {loading ? (
            <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="mb-3 text-sm text-red-600">{error}</p>
              <button onClick={() => setReloadKey((value) => value + 1)} className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white"><RefreshCw size={13} />重新加载</button>
            </div>
          ) : view === 'activities' ? (
            activities.length === 0 ? <div className="flex h-full items-center justify-center text-sm text-slate-400">没有符合条件的流水</div> : (
              <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-100 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
                {activities.map((activity) => {
                  const quantity = getActivityQuantity(activity);
                  const grossAmount = getActivityGrossAmount(activity);
                  return <div key={activity.id} className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-800 dark:text-zinc-100">{activity.productName || activity.sku}</div>
                        <div className="mt-1 text-xs text-slate-500">{getActivityTypeLabel(activity.type)} · {activity.sku} · {formatProductSize(activity.size || '')}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={`text-sm font-bold ${quantity === 0 ? 'text-red-500' : 'text-slate-800 dark:text-zinc-100'}`}>{quantity === 0 ? `异常 ${activity.count}` : `x${quantity}`}</div>
                        {!['restore', 'transfer'].includes(activity.type) && <div className="text-[10px] text-slate-400">合计 ¥{grossAmount}</div>}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-4 text-slate-400">
                      <span>{activity.createdAt ? new Date(activity.createdAt).toLocaleString('zh-CN') : '时间未知'}</span>
                      <span>{activity.warehouse || '未设置仓库'}</span>
                      <span>{activity.type === 'outbound' ? '售价' : '单价'} ¥{activity.price ?? 0}</span>
                      <span>成本 {activity.cost == null ? '未记录' : `¥${activity.cost}`}</span>
                      <span>{activity.platform || '未记录平台'}</span>
                      <span>{activity.source || '未记录来源'}</span>
                    </div>
                    {quantity === 0 && <div className="mt-2 flex items-center gap-1 text-[11px] text-red-500"><AlertTriangle size={12} />异常流水，不计入经营统计</div>}
                  </div>;
                })}
              </div>
            )
          ) : repairs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-sm text-slate-400"><History size={30} className="mb-2" />暂无修复记录</div>
          ) : (
            <div className="space-y-2">
              {repairs.map((repair) => <div key={repair.id} className="rounded-lg border border-slate-100 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
                <div className="font-medium text-slate-700 dark:text-zinc-200">{repair.targetTable === 'products' ? '商品库存修复' : '流水数量修复'}</div>
                <div className="mt-1 text-slate-500">原值 {repair.oldValue} → 新值 {repair.newValue}</div>
                {(repair.oldStatus || repair.newStatus) && <div className="mt-1 text-slate-500">状态：{statusLabels[repair.oldStatus || ''] || repair.oldStatus} → {statusLabels[repair.newStatus || ''] || repair.newStatus}</div>}
                <div className="mt-1 text-slate-500">依据：{repair.reason}</div>
                <div className="mt-1 flex items-center gap-1 break-all text-[10px] text-slate-400"><Clock3 size={11} className="shrink-0" />{new Date(repair.createdAt).toLocaleString('zh-CN')} · {repair.recordId}</div>
              </div>)}
            </div>
          )}
        </div>

        {totalCount > 0 && (
          <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-zinc-800">
            <span>共 {totalCount} 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="p-2 disabled:opacity-30" aria-label="上一页"><ChevronLeft size={17} /></button>
              <button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} className="p-2 disabled:opacity-30" aria-label="下一页"><ChevronRight size={17} /></button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
};
