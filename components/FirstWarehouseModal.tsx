import React, { useEffect, useState } from 'react';
import { ArrowRight, Loader2, RefreshCw, Warehouse as WarehouseIcon, X } from 'lucide-react';
import type { Warehouse } from '../types';
import { clearPendingFirstWarehouseCreation, loadPendingFirstWarehouseCreation, savePendingFirstWarehouseCreation } from '../services/firstWarehouseCreation';

interface FirstWarehouseModalProps {
  isOpen: boolean;
  userId: string;
  onClose: () => void;
  onCreate: (name: string) => Promise<Warehouse>;
  onVerify: (name: string) => Promise<Warehouse | null>;
  onCreated: (warehouse: Warehouse) => void;
}

export const FirstWarehouseModal: React.FC<FirstWarehouseModalProps> = ({
  isOpen,
  userId,
  onClose,
  onCreate,
  onVerify,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [resultUnknown, setResultUnknown] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setBusy(false);
    setHydrating(true);
    setResultUnknown(false);
    setError('');
    let active = true;
    loadPendingFirstWarehouseCreation(userId)
      .then((pending) => {
        if (!active || !pending) return;
        setName(pending.name);
        setResultUnknown(true);
        setError('上次创建请求的结果尚未核对。请先核对，不要重复创建。');
      })
      .catch(() => {
        if (active) setError('无法读取上次创建状态，请重试打开窗口');
      })
      .finally(() => {
        if (active) setHydrating(false);
      });
    return () => { active = false; };
  }, [isOpen, userId]);

  if (!isOpen) return null;

  const createFirstWarehouse = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || busy || hydrating || resultUnknown) return;

    setBusy(true);
    setError('');
    try {
      await savePendingFirstWarehouseCreation(userId, trimmedName);
      const warehouse = await onCreate(trimmedName);
      await clearPendingFirstWarehouseCreation(userId);
      onCreated(warehouse);
    } catch (createError: any) {
      if (createError?.code === 'WAREHOUSE_CREATE_UNKNOWN') {
        setResultUnknown(true);
        setError('创建请求的结果暂时无法确认。请先核对，不要重复创建。');
      } else {
        await clearPendingFirstWarehouseCreation(userId).catch(() => {});
        setError(createError?.message || '创建仓库失败，请稍后重试');
      }
    } finally {
      setBusy(false);
    }
  };

  const verifyCreation = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const warehouse = await onVerify(name.trim());
      if (warehouse) {
        await clearPendingFirstWarehouseCreation(userId);
        onCreated(warehouse);
        return;
      }
      setResultUnknown(false);
      await clearPendingFirstWarehouseCreation(userId);
      setError('已确认仓库尚未创建，可以重新提交。');
    } catch (verifyError: any) {
      setResultUnknown(true);
      setError(verifyError?.message || '仍无法核对创建结果，请检查网络后重试核对');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[70] flex items-end bg-slate-950/45 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="first-warehouse-title">
      <div className="w-full rounded-t-2xl bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl dark:bg-zinc-900 sm:max-w-sm sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-dewu-50 text-dewu-600 dark:bg-dewu-950/40 dark:text-dewu-300">
              <WarehouseIcon size={20} />
            </div>
            <div className="min-w-0">
              <h2 id="first-warehouse-title" className="text-base font-bold text-slate-900 dark:text-white">创建第一个仓库</h2>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-500 dark:text-zinc-400">填写真实名称。首个仓库会自动成为主仓，创建后继续首次入库。</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy || hydrating || resultUnknown} aria-label={resultUnknown ? '创建结果待核对，暂时不能关闭' : '关闭创建仓库'} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-zinc-800">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={createFirstWarehouse} className="mt-5 space-y-4" noValidate>
          <label className="block text-xs font-medium text-slate-600 dark:text-zinc-300">
            仓库名称 <span className="text-rose-500">必填</span>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!resultUnknown) setError('');
              }}
              disabled={busy || hydrating || resultUnknown}
              maxLength={60}
              autoComplete="off"
              enterKeyHint="done"
              placeholder="例如：家里主仓"
              aria-describedby={error ? 'first-warehouse-error' : undefined}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 outline-none focus:border-dewu-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </label>

          <p className="text-[11px] leading-4 text-slate-400 dark:text-zinc-500">不会添加演示仓库或演示库存。费用方案可以稍后按实际出售模式配置。</p>

          {error && (
            <div id="first-warehouse-error" role="status" className={`rounded-xl border px-3 py-2 text-[11px] leading-4 ${resultUnknown ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300' : 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300'}`}>
              {error}
            </div>
          )}

          {resultUnknown ? (
            <button type="button" onClick={verifyCreation} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white disabled:opacity-50 dark:bg-white dark:text-black">
              {busy ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
              核对创建结果
            </button>
          ) : (
            <button type="submit" disabled={busy || hydrating || !name.trim()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-dewu-500 py-3 text-sm font-bold text-white disabled:opacity-50">
              {busy || hydrating ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />}
              {hydrating ? '正在核对上次状态' : '创建并继续入库'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
