import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileJson, FileSpreadsheet, Loader2, RotateCcw, Upload, X } from 'lucide-react';
import { buildInventoryCsv } from '../lib/inventoryExport';
import { LedgerBackupPackage, parseLedgerBackupPackage, serializeLedgerBackupPackage } from '../lib/ledgerBackup';
import { listProductsForExport } from '../services/products';
import { createFullLedgerBackup, executeLedgerRestore, LedgerRestoreResult, previewLedgerRestore } from '../services/ledgerBackup';

interface BackupRestoreModalProps {
  isOpen: boolean;
  userId: string;
  onClose: () => void;
  onRestored: () => void;
}

const downloadText = (content: string, filename: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const getLocalExportStamp = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
};

export const BackupRestoreModal: React.FC<BackupRestoreModalProps> = ({ isOpen, userId, onClose, onRestored }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'csv' | 'json' | 'preview' | 'restore' | ''>('');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [backup, setBackup] = useState<LedgerBackupPackage | null>(null);
  const [preview, setPreview] = useState<LedgerRestoreResult | null>(null);
  const [result, setResult] = useState<LedgerRestoreResult | null>(null);
  const [operationId, setOperationId] = useState('');

  useEffect(() => {
    if (isOpen) return;
    setBusy(''); setError(''); setFileName(''); setBackup(null); setPreview(null); setResult(null); setOperationId('');
  }, [isOpen]);

  if (!isOpen) return null;

  const exportCsv = async () => {
    setBusy('csv'); setError('');
    try {
      const products = await listProductsForExport(userId);
      downloadText(buildInventoryCsv(products), `dewu-inventory-${getLocalExportStamp()}.csv`, 'text/csv;charset=utf-8');
    } catch (err: any) { setError(err?.message || '库存 CSV 导出失败'); }
    finally { setBusy(''); }
  };

  const exportJson = async () => {
    setBusy('json'); setError('');
    try {
      const ledger = await createFullLedgerBackup(userId);
      downloadText(serializeLedgerBackupPackage(ledger), `dewu-ledger-${getLocalExportStamp()}.json`, 'application/json;charset=utf-8');
    } catch (err: any) { setError(err?.message || '完整账本包导出失败'); }
    finally { setBusy(''); }
  };

  const selectBackup = async (file?: File) => {
    if (!file) return;
    setBusy('preview'); setError(''); setResult(null); setPreview(null); setBackup(null); setFileName(file.name);
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('账本包不能超过 25MB');
      const parsed = await parseLedgerBackupPackage(await file.text());
      const nextPreview = await previewLedgerRestore(userId, parsed);
      setBackup(parsed);
      setPreview(nextPreview);
      setOperationId(`restore-${parsed.integrity.value.slice(0, 16)}-${crypto.randomUUID()}`);
    } catch (err: any) { setError(err?.message || '账本包预检失败'); }
    finally { setBusy(''); if (inputRef.current) inputRef.current.value = ''; }
  };

  const restore = async () => {
    if (!backup || !preview || !operationId) return;
    const confirmed = window.confirm(`确认恢复这个账本包？\n\n新增 ${preview.added} 条，合并 ${preview.merged} 条，冲突/异常 ${preview.conflicts} 条，跳过 ${preview.skipped} 条。\n\n不会覆盖当前商品；冲突或异常项不会写入核心账本。字段异常及无法映射的原始载荷会进入仅当前账号可见的恢复隔离区，重复或已有记录保持原状。\n\n图片文件不在账本包中，不会恢复或覆盖。`);
    if (!confirmed) return;
    setBusy('restore'); setError('');
    try {
      const restored = await executeLedgerRestore(userId, operationId, backup);
      setResult(restored);
      onRestored();
    } catch (err: any) { setError(err?.message || '账本恢复失败，数据库未写入任何内容'); }
    finally { setBusy(''); }
  };

  const summary = result || preview;
  const hasRestoreWork = Boolean(preview && (preview.added > 0 || preview.merged > 0 || preview.conflicts > 0));
  const onlyConflicts = Boolean(preview && preview.added === 0 && preview.merged === 0 && preview.conflicts > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="backup-title" className="flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-zinc-800">
          <div><h2 id="backup-title" className="font-bold text-slate-900 dark:text-white">导出与恢复</h2><p className="text-xs text-slate-500">库存清单和可恢复账本包</p></div>
          <button onClick={onClose} className="p-2 text-slate-400" aria-label="关闭导出与恢复"><X size={20} /></button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4 dark:bg-black/40">
          <section>
            <h3 className="mb-2 text-xs font-bold text-slate-700 dark:text-zinc-200">导出</h3>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-100 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              <button onClick={exportCsv} disabled={Boolean(busy)} className="flex w-full items-center gap-3 p-3 text-left disabled:opacity-50">
                <FileSpreadsheet size={20} className="text-emerald-600" /><div className="flex-1"><div className="text-sm font-medium text-slate-800 dark:text-white">库存 CSV</div><div className="text-[11px] text-slate-400">人可读清单，包含当前与回收站商品</div></div>{busy === 'csv' ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
              </button>
              <button onClick={exportJson} disabled={Boolean(busy)} className="flex w-full items-center gap-3 p-3 text-left disabled:opacity-50">
                <FileJson size={20} className="text-blue-600" /><div className="flex-1"><div className="text-sm font-medium text-slate-800 dark:text-white">JSON 账本包</div><div className="text-[11px] text-slate-400">商品、流水、仓库、修复审计与完整性校验</div></div>{busy === 'json' ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
              </button>
            </div>
            <div className="mt-2 flex gap-2 rounded-lg border border-amber-100 bg-amber-50 p-2 text-[11px] leading-4 text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />账本包不包含图片文件或临时签名链接；恢复后图片使用无图占位。
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-bold text-slate-700 dark:text-zinc-200">恢复预检</h3>
            <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => selectBackup(event.target.files?.[0])} />
            <button onClick={() => inputRef.current?.click()} disabled={Boolean(busy)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white py-3 text-sm font-medium text-slate-600 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
              {busy === 'preview' ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} />}{busy === 'preview' ? '正在校验和预检' : '选择 JSON 账本包'}
            </button>
            {fileName && <p className="mt-1 truncate text-[11px] text-slate-400">{fileName}</p>}
          </section>

          {summary && (
            <section className="rounded-lg border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 flex items-center gap-2">
                {result && result.conflicts === 0 ? <CheckCircle2 size={17} className="text-emerald-500" /> : result ? <AlertTriangle size={17} className="text-amber-500" /> : <RotateCcw size={17} className="text-blue-500" />}
                <span className="text-sm font-semibold text-slate-800 dark:text-white">{result ? (result.conflicts > 0 ? '恢复完成，部分记录已隔离' : '恢复完成') : '恢复预检结果'}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[['新增',summary.added],['合并',summary.merged],['冲突/隔离',summary.conflicts],['跳过',summary.skipped]].map(([label,value]) => <div key={String(label)} className="rounded-md bg-slate-50 px-1 py-2 dark:bg-zinc-800"><div className="text-base font-bold text-slate-800 dark:text-white">{value}</div><div className="text-[10px] text-slate-400">{label}</div></div>)}
              </div>
              {summary.details.length > 0 && <div className="mt-3 max-h-28 space-y-1 overflow-y-auto text-[11px] text-amber-700 dark:text-amber-300">{summary.details.slice(0, 20).map((item, index) => <div key={`${item.entity}-${item.sourceId}-${index}`}>{item.entity} · {item.sourceId || '无标识'}：{item.reason || item.outcome}</div>)}</div>}
              {summary.details.length > 0 && <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">页面展示前 {Math.min(20, summary.details.length)} 条，共返回 {summary.details.length} 条明细。{summary.detailsTruncated ? `服务端仅保留前 100 条，共 ${summary.conflicts} 条冲突/异常。` : ''}</div>}
              {!result && summary.conflicts > 0 && <div className="mt-2 rounded-md bg-amber-50 p-2 text-[11px] leading-4 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300">确认后，冲突或异常项不会写入核心账本；字段异常与悬空审计会隔离保存，重复或已有记录保持原状。</div>}
              {!result && <button onClick={restore} disabled={busy === 'restore' || !hasRestoreWork} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:bg-dewu-600 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400">{busy === 'restore' && <Loader2 size={16} className="animate-spin" />}{hasRestoreWork ? (onlyConflicts ? '确认处理冲突' : '确认恢复') : '无需恢复'}</button>}
            </section>
          )}

          {error && <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">{error}</div>}
        </div>
      </div>
    </div>
  );
};
