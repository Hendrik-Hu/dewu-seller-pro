import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Clock3, History, Loader2, RefreshCw, X } from 'lucide-react';
import { Preferences } from '@capacitor/preferences';
import type { Activity, OutboundSettlementAudit } from '../types';
import { calculateSettlementPreview, normalizeSettlementFee } from '../lib/settlementCalculations';
import { listOutboundSettlementAudit, saveOutboundSettlement } from '../services/settlements';

interface SettlementModalProps {
  activity: Activity | null;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}

const createOperationId = (): string => globalThis.crypto?.randomUUID?.() || `settlement-${Date.now()}`;
const draftKey = (userId: string, activityId: string) => `settlementDraftV1:${userId}:${activityId}`;
const localDateTime = (value = new Date()) => {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export const SettlementModal: React.FC<SettlementModalProps> = ({ activity, userId, onClose, onSaved }) => {
  const [fee, setFee] = useState('');
  const [settledAt, setSettledAt] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [note, setNote] = useState('');
  const [operationId, setOperationId] = useState(createOperationId);
  const [audits, setAudits] = useState<OutboundSettlementAudit[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [initKey, setInitKey] = useState(0);

  useEffect(() => {
    if (!activity) return;
    let mounted = true;
    setReady(false);
    setFee('');
    setSettledAt('');
    setOrderNo('');
    setNote('');
    setAudits([]);
    setError('');
    setOperationId(createOperationId());
    Promise.all([
      Preferences.get({ key: draftKey(userId, activity.id) }),
      listOutboundSettlementAudit(userId, activity.id),
    ]).then(([draftResult, history]) => {
      if (!mounted) return;
      const draft = draftResult.value ? JSON.parse(draftResult.value) : null;
      setFee(String(draft?.fee ?? activity.actualPlatformFee ?? ''));
      setSettledAt(String(draft?.settledAt || (activity.settledAt ? localDateTime(new Date(activity.settledAt)) : localDateTime())));
      setOrderNo(String(draft?.orderNo ?? activity.settlementOrderNo ?? ''));
      setNote(String(draft?.note ?? activity.settlementNote ?? ''));
      setOperationId(String(draft?.operationId || createOperationId()));
      setAudits(history);
      if (mounted) setReady(true);
    }).catch((caught) => {
      if (!mounted) return;
      setError(caught instanceof Error ? caught.message : '结算记录加载失败');
      setReady(false);
    });
    return () => { mounted = false; };
  }, [activity, initKey, userId]);

  useEffect(() => {
    if (!activity || !ready) return;
    Preferences.set({ key: draftKey(userId, activity.id), value: JSON.stringify({ fee, settledAt, orderNo, note, operationId }) })
      .catch(() => {});
  }, [activity, fee, note, operationId, orderNo, ready, settledAt, userId]);

  const preview = useMemo(() => {
    if (!activity || !fee.trim()) return undefined;
    try { return calculateSettlementPreview(activity, normalizeSettlementFee(fee)); } catch { return undefined; }
  }, [activity, fee]);

  if (!activity) return null;

  const close = async () => {
    await Preferences.remove({ key: draftKey(userId, activity.id) }).catch(() => {});
    onClose();
  };

  const submit = async () => {
    try {
      const actualPlatformFee = normalizeSettlementFee(fee);
      calculateSettlementPreview(activity, actualPlatformFee);
      if (!settledAt.trim() || Number.isNaN(new Date(settledAt).getTime())) throw new Error('请选择有效的结算时间');
      if (orderNo.trim().length > 100) throw new Error('订单号不能超过 100 个字符');
      if (note.trim().length > 500) throw new Error('备注不能超过 500 个字符');
      setLoading(true); setError('');
      await saveOutboundSettlement({ userId, activityId: activity.id, operationId, actualPlatformFee, settledAt: new Date(settledAt).toISOString(), orderNo, note });
      await Preferences.remove({ key: draftKey(userId, activity.id) });
      onSaved(); onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '结算保存失败');
    } finally { setLoading(false); }
  };

  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="settlement-title" className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl dark:bg-zinc-900">
      <header className="mb-4 flex items-start justify-between">
        <div><h2 id="settlement-title" className="font-bold text-slate-900 dark:text-white">{activity.settlementRevision ? '更正实际结算' : '补录实际结算'}</h2><p className="mt-0.5 text-xs text-slate-500">{activity.productName} · {activity.sku}</p></div>
        <button onClick={close} className="p-2 text-slate-400" aria-label="关闭实际结算"><X size={20} /></button>
      </header>

      {!ready ? (error ? <div className="flex flex-col items-center py-10 text-center"><p className="mb-3 text-sm text-red-600">{error}</p><button onClick={() => setInitKey((value) => value + 1)} className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white"><RefreshCw size={13} />重新加载</button></div> : <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-400" /></div>) : <div className="space-y-3">
        <div className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-zinc-800">
          <div className="flex justify-between"><span className="text-slate-500">成交总额</span><strong>¥{(activity.price * (activity.count ?? 1)).toFixed(2)}</strong></div>
          <div className="mt-1 flex justify-between"><span className="text-slate-500">出库冻结成本</span><strong>{activity.cost == null ? '未记录' : `¥${(activity.cost * (activity.count ?? 1)).toFixed(2)}`}</strong></div>
          <p className="mt-2 text-[10px] text-slate-400">净利润仅使用这笔出库流水冻结的成本，不读取当前库存成本。</p>
        </div>

        <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">实际平台总费用（允许 0 元）
          <input type="number" min="0" step="0.01" value={fee} onChange={(event) => setFee(event.target.value)} placeholder="0.00" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-dewu-500 dark:border-zinc-700 dark:bg-zinc-800" />
        </label>
        <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">结算时间
          <input type="datetime-local" value={settledAt} onChange={(event) => setSettledAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-dewu-500 dark:border-zinc-700 dark:bg-zinc-800" />
        </label>
        <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">平台订单号（选填）
          <input maxLength={100} value={orderNo} onChange={(event) => setOrderNo(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-dewu-500 dark:border-zinc-700 dark:bg-zinc-800" />
        </label>
        <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">核对备注（选填）
          <textarea maxLength={500} rows={2} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-dewu-500 dark:border-zinc-700 dark:bg-zinc-800" />
        </label>

        {preview && <div className={`rounded-xl border p-3 text-xs ${preview.actualNetProceeds < 0 ? 'border-red-200 bg-red-50' : 'border-emerald-100 bg-emerald-50/60'}`}>
          <div className="grid grid-cols-2 gap-y-1.5"><span className="text-slate-500">实际到手</span><strong className="text-right">¥{preview.actualNetProceeds.toFixed(2)}</strong><span className="text-slate-500">实际净利润</span><strong className="text-right">{preview.actualNetProfit == null ? '成本未知' : `¥${preview.actualNetProfit.toFixed(2)}`}</strong><span className="text-slate-500">费用偏差</span><strong className="text-right">{preview.feeVariance == null ? '估算未知' : `${preview.feeVariance >= 0 ? '+' : ''}¥${preview.feeVariance.toFixed(2)}`}</strong><span className="text-slate-500">利润偏差</span><strong className="text-right">{preview.profitVariance == null ? '估算未知' : `${preview.profitVariance >= 0 ? '+' : ''}¥${preview.profitVariance.toFixed(2)}`}</strong></div>
        {preview.actualNetProceeds < 0 && <p className="mt-2 text-[11px] font-medium text-red-600">实际费用高于成交额，本笔到手为负，请核对处罚、售后或补缴明细。</p>}</div>}

        {audits.length > 0 && <details className="rounded-xl border border-slate-100 p-3 text-xs dark:border-zinc-800"><summary className="flex cursor-pointer items-center gap-1 font-medium"><History size={14} />结算审计 {audits.length} 版</summary><div className="mt-2 space-y-2">{audits.map((audit) => {
          const current = audit.settlementSnapshot as any;
          const previous = audit.previousSnapshot as any;
          return <div key={audit.id} className="rounded-lg bg-slate-50 p-2 text-slate-500 dark:bg-zinc-800"><div className="flex justify-between"><span>第 {audit.revision} 版</span><span>{new Date(audit.createdAt).toLocaleString('zh-CN')}</span></div><div className="mt-1">实际费用 {previous ? `¥${Number(previous.actualPlatformFee).toFixed(2)} → ` : ''}¥{Number(current.actualPlatformFee).toFixed(2)} · 到手 ¥{Number(current.actualNetProceeds).toFixed(2)}</div><div className="mt-1">结算时间 {new Date(current.settledAt).toLocaleString('zh-CN')}</div>{current.orderNo && <div className="mt-1 break-all">订单号 {current.orderNo}</div>}{current.note && <div className="mt-1 break-words">备注 {current.note}</div>}</div>;
        })}</div></details>}
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
        <button disabled={loading || !fee.trim() || !settledAt.trim()} onClick={submit} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white disabled:opacity-40"><Calculator size={16} />{loading ? '保存中...' : activity.settlementRevision ? '确认更正并留痕' : '确认补录结算'}</button>
      </div>}
    </div>
  </div>;
};
