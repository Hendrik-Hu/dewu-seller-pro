import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, History, Loader2, Scale, X } from 'lucide-react';
import { Product } from '../types';
import { formatProductSize } from '../lib/productNormalization';
import { parseInventoryAdjustment } from '../lib/inventoryAdjustment';
import {
  adjustProductInventory,
  clearInventoryAdjustmentDraft,
  createInventoryAdjustmentOperationId,
  findInventoryAdjustmentByOperation,
  InventoryAdjustmentAudit,
  InventoryAdjustmentDraft,
  listInventoryAdjustmentAudits,
  loadInventoryAdjustmentDraft,
  saveInventoryAdjustmentDraft,
} from '../services/inventoryAdjustments';

interface InventoryAdjustmentModalProps {
  isOpen: boolean;
  userId: string;
  product: Product | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export const InventoryAdjustmentModal: React.FC<InventoryAdjustmentModalProps> = ({
  isOpen, userId, product, onClose, onSaved,
}) => {
  const [draft, setDraft] = useState<InventoryAdjustmentDraft | null>(null);
  const [audits, setAudits] = useState<InventoryAdjustmentAudit[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof adjustProductInventory>> | null>(null);
  const [confirmation, setConfirmation] = useState<ReturnType<typeof parseInventoryAdjustment> | null>(null);

  useEffect(() => {
    if (!isOpen || !product) return;
    let cancelled = false;
    setReady(false);
    setError('');
    setResult(null);
    setConfirmation(null);
    setAudits([]);
    const fallback: InventoryAdjustmentDraft = {
      operationId: createInventoryAdjustmentOperationId(),
      newStock: String(product.stock),
      newCost: product.price.toFixed(2),
      reason: '',
      submissionState: 'editing',
      expectedStock: product.stock,
      expectedCost: product.price,
      expectedStatus: product.status,
    };
    Promise.all([
      loadInventoryAdjustmentDraft(userId, product.id),
      listInventoryAdjustmentAudits(userId, product.id, 10),
    ]).then(([savedDraft, history]) => {
      if (cancelled) return;
      setDraft(savedDraft
        ? savedDraft.submissionState === 'editing'
          ? { ...savedDraft, expectedStock: product.stock, expectedCost: product.price, expectedStatus: product.status }
          : savedDraft
        : fallback);
      setAudits(history);
      setReady(true);
    }).catch((loadError: any) => {
      if (cancelled) return;
      setDraft(fallback);
      setError(loadError?.message || '盘点记录加载失败，请重试');
      setReady(false);
    });
    return () => { cancelled = true; };
  }, [isOpen, product?.id, userId]);

  useEffect(() => {
    if (!isOpen || !product || !ready || !draft || result) return;
    const timer = window.setTimeout(() => {
      saveInventoryAdjustmentDraft(userId, product.id, draft).catch((saveError) => {
        console.warn('Inventory adjustment draft could not be cached.', saveError);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, isOpen, product?.id, ready, result, userId]);

  const preview = useMemo(() => {
    if (!product || !draft) return null;
    const newStock = draft.newStock.trim() === '' ? null : Number(draft.newStock);
    const newCost = draft.newCost.trim() === '' ? null : Number(draft.newCost);
    const newStatus = product.status === 'sold' && Number.isFinite(newStock) && Number(newStock) > 0
      ? 'instock'
      : product.status === 'instock' && newStock === 0
        ? 'sold'
        : product.status;
    return { newStock, newCost, newStatus };
  }, [draft, product]);

  if (!isOpen || !product) return null;

  const updateDraft = (changes: Partial<InventoryAdjustmentDraft>) => {
    setDraft((current) => current?.submissionState === 'editing' ? { ...current, ...changes } : current);
    setConfirmation(null);
    setError('');
  };

  const acceptCommittedResult = async (saved: Awaited<ReturnType<typeof adjustProductInventory>>) => {
    setResult(saved);
    clearInventoryAdjustmentDraft(userId, product.id).catch((clearError) => {
      console.warn('Committed inventory adjustment draft could not be cleared.', clearError);
    });
    try {
      await onSaved();
      setAudits(await listInventoryAdjustmentAudits(userId, product.id, 10));
    } catch (refreshError) {
      console.warn('Committed inventory adjustment could not be refreshed immediately.', refreshError);
    }
  };

  const resultFromAudit = (audit: InventoryAdjustmentAudit) => ({
    auditId: audit.id,
    productId: audit.productId,
    oldStock: audit.oldStock,
    newStock: audit.newStock,
    oldCost: audit.oldCost,
    newCost: audit.newCost,
    oldStatus: audit.oldStatus,
    newStatus: audit.newStatus,
    replayed: true,
  });

  const handleSubmit = async () => {
    if (!draft || !ready) return;
    setError('');
    if (draft.submissionState === 'submitted') {
      setBusy(true);
      try {
        const existing = await findInventoryAdjustmentByOperation(userId, draft.operationId);
        if (existing) {
          await acceptCommittedResult(resultFromAudit(existing));
        } else {
          const retryable = { ...draft, submissionState: 'retryable' as const };
          await saveInventoryAdjustmentDraft(userId, product.id, retryable);
          setDraft(retryable);
          setError('暂未查到已提交记录。原请求已锁定，请核对网络后重试原调整；不会生成新的操作号。');
        }
      } catch (lookupError: any) {
        setError(lookupError?.message || '暂时无法核对上次调整，请稍后重试');
      } finally {
        setBusy(false);
      }
      return;
    }
    let parsed;
    try {
      parsed = parseInventoryAdjustment(product, draft.newStock, draft.newCost, draft.reason);
    } catch (validationError: any) {
      setError(validationError?.message || '请核对调整内容');
      return;
    }
    if (draft.submissionState !== 'editing' && (
      !Number.isFinite(draft.expectedStock) || !Number.isFinite(draft.expectedCost) || !draft.expectedStatus
    )) {
      setError('锁定请求缺少原库存快照，请放弃原请求并刷新后重新盘点');
      return;
    }
    if (draft.submissionState === 'editing') {
      setConfirmation(parsed);
      return;
    }
    setBusy(true);
    try {
      const saved = await adjustProductInventory({
        productId: product.id,
        operationId: draft.operationId,
        expectedStock: Number(draft.expectedStock),
        expectedCost: Number(draft.expectedCost),
        expectedStatus: draft.expectedStatus!,
        ...parsed,
      });
      await acceptCommittedResult(saved);
    } catch (submitError: any) {
      setError(submitError?.message || '调整结果暂不确定。请求已锁定，请使用“核对上次调整”。');
    } finally {
      setBusy(false);
    }
  };

  const confirmAdjustment = async () => {
    if (!draft || !confirmation || draft.submissionState !== 'editing') return;
    const submittedDraft: InventoryAdjustmentDraft = {
      ...draft,
      submissionState: 'submitted',
      expectedStock: product.stock,
      expectedCost: product.price,
      expectedStatus: product.status,
    };
    setBusy(true);
    setError('');
    try {
      await saveInventoryAdjustmentDraft(userId, product.id, submittedDraft);
      setDraft(submittedDraft);
    } catch {
      setError('无法锁定本次调整请求，尚未提交。请检查设备存储后重试。');
      setBusy(false);
      return;
    }
    try {
      const saved = await adjustProductInventory({
        productId: product.id,
        operationId: submittedDraft.operationId,
        expectedStock: submittedDraft.expectedStock!,
        expectedCost: submittedDraft.expectedCost!,
        expectedStatus: submittedDraft.expectedStatus!,
        ...confirmation,
      });
      setConfirmation(null);
      await acceptCommittedResult(saved);
    } catch (submitError: any) {
      setConfirmation(null);
      setError(submitError?.message || '调整结果暂不确定。请求已锁定，请使用“核对上次调整”。');
    } finally {
      setBusy(false);
    }
  };

  const abandonRetryableRequest = async () => {
    if (!draft || draft.submissionState !== 'retryable') return;
    setBusy(true);
    try {
      await clearInventoryAdjustmentDraft(userId, product.id);
      await onSaved();
      onClose();
    } catch (refreshError: any) {
      setError(refreshError?.message || '刷新当前库存失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-950">
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-zinc-800">
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white">盘点调整 / 成本校正</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">{product.sku} · {formatProductSize(product.size)} · {product.warehouse}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-slate-400" aria-label="关闭盘点调整"><X size={19} /></button>
        </header>

        <div className="space-y-4 overflow-y-auto p-4">
          <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            仅用于实物盘点差异和历史成本校正。正常进货请用“入库”，正常卖出请用“出库”。
          </div>

          {!ready || !draft ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 size={18} className="animate-spin" />加载盘点草稿</div>
          ) : result ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={18} />调整已记账</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white/80 p-2 dark:bg-zinc-900/60"><div className="text-slate-400">库存</div><div className="mt-1 font-semibold">{result.oldStock} → {result.newStock}</div></div>
                <div className="rounded-lg bg-white/80 p-2 dark:bg-zinc-900/60"><div className="text-slate-400">平均成本</div><div className="mt-1 font-semibold">¥{result.oldCost.toFixed(2)} → ¥{result.newCost.toFixed(2)}</div></div>
              </div>
              {result.replayed && <p className="mt-2 text-[11px] text-emerald-700">网络重试已命中原记录，没有重复调整。</p>}
              <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white">完成</button>
            </div>
          ) : confirmation ? (
            <section className="space-y-4" aria-label="盘点调整确认">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">确认本次盘点</h3>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">确认记账后将锁定本次请求，并写入不可静默覆盖的调整审计。</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-white p-2.5 dark:bg-zinc-950"><div className="text-slate-400">库存</div><div className="mt-1 font-semibold">{product.stock} → {confirmation.newStock}</div></div>
                  <div className="rounded-lg bg-white p-2.5 dark:bg-zinc-950"><div className="text-slate-400">平均成本</div><div className="mt-1 font-semibold">¥{product.price.toFixed(2)} → ¥{confirmation.newCost.toFixed(2)}</div></div>
                </div>
                {preview?.newStatus !== product.status && (
                  <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
                    状态：{product.status === 'instock' ? '在售' : '已售罄'} → {preview?.newStatus === 'instock' ? '在售' : '已售罄'}
                  </div>
                )}
                <div className="mt-3 rounded-lg bg-white p-2.5 text-xs dark:bg-zinc-950"><div className="text-slate-400">核对原因</div><div className="mt-1 break-words text-slate-700 dark:text-zinc-200">{confirmation.reason}</div></div>
              </div>
              {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirmation(null)} disabled={busy} className="rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">返回修改</button>
                <button type="button" onClick={confirmAdjustment} disabled={busy} className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-dewu-500">
                  {busy ? <Loader2 size={17} className="animate-spin" /> : <Scale size={17} />}{busy ? '正在记账' : '确认记账'}
                </button>
              </div>
            </section>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-500">盘点后库存 <span className="text-rose-500">必填</span>
                  <input type="number" min="0" step="1" value={draft.newStock} disabled={draft.submissionState !== 'editing'} onChange={(event) => updateDraft({ newStock: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-dewu-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
                </label>
                <label className="text-xs text-slate-500">校正后平均成本 <span className="text-rose-500">必填</span>
                  <input type="number" min="0" step="0.01" value={draft.newCost} disabled={draft.submissionState !== 'editing'} onChange={(event) => updateDraft({ newCost: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-dewu-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs dark:bg-zinc-900">
                <div><div className="text-slate-400">库存变化</div><div className="mt-1 font-semibold text-slate-900 dark:text-white">{product.stock} → {Number.isFinite(preview?.newStock) ? preview?.newStock : '—'}</div></div>
                <div><div className="text-slate-400">成本变化</div><div className="mt-1 font-semibold text-slate-900 dark:text-white">¥{product.price.toFixed(2)} → {Number.isFinite(preview?.newCost) ? `¥${Number(preview?.newCost).toFixed(2)}` : '—'}</div></div>
              </div>
              {preview?.newStatus !== product.status && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
                  状态将自动从“{product.status === 'instock' ? '在售' : '已售罄'}”变为“{preview?.newStatus === 'instock' ? '在售' : '已售罄'}”，并写入同一条审计。
                </div>
              )}

              <label className="block text-xs text-slate-500">核对原因 <span className="text-rose-500">必填</span>
                <textarea maxLength={500} rows={3} value={draft.reason} disabled={draft.submissionState !== 'editing'} onChange={(event) => updateDraft({ reason: event.target.value })} placeholder="例如：2026-08-11 实物盘点，发现少 1 双并核对采购记录" className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-dewu-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
                <div className="mt-1 text-right text-[10px] text-slate-400">{draft.reason.length}/500</div>
              </label>
              {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}
              <button type="button" onClick={handleSubmit} disabled={busy || !ready} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-dewu-500">
                {busy ? <Loader2 size={17} className="animate-spin" /> : <Scale size={17} />}{busy ? '正在核对' : draft.submissionState === 'submitted' ? '核对上次调整' : draft.submissionState === 'retryable' ? '重试原调整' : '核对并提交调整'}
              </button>
              {draft.submissionState === 'retryable' && (
                <button type="button" onClick={abandonRetryableRequest} disabled={busy} className="w-full rounded-xl border border-slate-200 py-2.5 text-xs font-medium text-slate-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
                  放弃原请求，刷新后新建盘点
                </button>
              )}
            </>
          )}

          {audits.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-zinc-200"><History size={14} />最近调整记录</div>
              <div className="space-y-2">
                {audits.map((audit) => (
                  <div key={audit.id} className="rounded-lg border border-slate-100 p-2.5 text-[11px] dark:border-zinc-800">
                    <div className="flex justify-between gap-2"><span className="font-medium text-slate-700 dark:text-zinc-200">库存 {audit.oldStock}→{audit.newStock} · 成本 ¥{audit.oldCost.toFixed(2)}→¥{audit.newCost.toFixed(2)}</span><span className="shrink-0 text-slate-400">{new Date(audit.createdAt).toLocaleString('zh-CN', { hour12: false })}</span></div>
                    <div className="mt-1 text-slate-500">{audit.reason}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
