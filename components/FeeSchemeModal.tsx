import React, { useEffect, useState } from 'react';
import { Calculator, Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { FeeScheme } from '../types';
import { deleteFeeScheme, listFeeSchemes, saveFeeScheme } from '../services/feeSchemes';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '../lib/feeSchemeDates';

interface FeeSchemeModalProps {
  isOpen: boolean;
  userId: string;
  onClose: () => void;
}

type FeeSchemeDraft = Omit<FeeScheme, 'id' | 'updatedAt'>;
const nowForInput = () => {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
};
const emptyDraft = (): FeeSchemeDraft => ({
  name: '', saleMode: '', category: '', percentRate: 0, percentMin: undefined, percentMax: undefined,
  percentageUnit: 'transaction', fixedFee: 0, fixedFeeUnit: 'transaction', shippingFee: 0,
  shippingFeeUnit: 'transaction', otherFee: 0, otherFeeUnit: 'transaction', effectiveFrom: new Date().toISOString(), isDefault: false,
});
const UnitToggle = ({ value, onChange }: { value: 'transaction' | 'item'; onChange: (value: 'transaction' | 'item') => void }) => (
  <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
    {([['transaction', '按本次交易'], ['item', '按件']] as const).map(([key, label]) => (
      <button key={key} type="button" onClick={() => onChange(key)} className={`px-2 py-1.5 text-[11px] font-medium ${value === key ? 'bg-slate-900 text-white dark:bg-dewu-600' : 'text-slate-500 dark:text-zinc-400'}`}>{label}</button>
    ))}
  </div>
);

export const FeeSchemeModal: React.FC<FeeSchemeModalProps> = ({ isOpen, userId, onClose }) => {
  const [schemes, setSchemes] = useState<FeeScheme[]>([]);
  const [draft, setDraft] = useState<FeeSchemeDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setIsLoading(true); setError('');
    try { setSchemes(await listFeeSchemes(userId)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '费用方案加载失败'); }
    finally { setIsLoading(false); }
  };

  useEffect(() => {
    if (isOpen) void load();
    else { setIsEditing(false); setEditingId(null); setDraft(emptyDraft()); setError(''); }
  }, [isOpen, userId]);
  if (!isOpen) return null;

  const beginCreate = () => { setDraft({ ...emptyDraft(), isDefault: schemes.length === 0 }); setEditingId(null); setIsEditing(true); setError(''); };
  const beginEdit = (scheme: FeeScheme) => {
    const { id, updatedAt, ...values } = scheme;
    setDraft(values); setEditingId(id); setIsEditing(true); setError('');
  };
  const updateNumber = (key: keyof FeeSchemeDraft, raw: string, optional = false) => {
    setDraft((value) => ({ ...value, [key]: optional && raw === '' ? undefined : Number(raw) }));
  };
  const handleSave = async () => {
    setIsSaving(true); setError('');
    try {
      await saveFeeScheme(userId, draft, editingId || undefined);
      setIsEditing(false); setEditingId(null); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存失败'); }
    finally { setIsSaving(false); }
  };
  const handleDelete = async (scheme: FeeScheme) => {
    if (!confirm(`删除费用方案“${scheme.name}”？历史出库快照不会受影响。`)) return;
    try { await deleteFeeScheme(userId, scheme.id); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '删除失败'); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <section className="flex max-h-[88vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-zinc-800">
          <div className="flex items-center gap-2"><Calculator className="text-dewu-500" size={19} /><h2 className="font-bold text-slate-900 dark:text-white">费用方案</h2></div>
          <button onClick={onClose} disabled={isSaving} className="p-2 text-slate-400 disabled:opacity-40"><X size={20} /></button>
        </header>

        <div className="overflow-y-auto p-4">
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-700">费用仅用于经营估算，实际金额以平台出价页和订单结算明细为准。</p>
          {!isEditing ? (
            <div className="space-y-3">
              <button onClick={beginCreate} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-dewu-300 py-3 text-sm font-medium text-dewu-600"><Plus size={17} />新增费用方案</button>
              {isLoading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-dewu-500" /></div> : schemes.length === 0 ? (
                <div className="py-10 text-center"><p className="text-sm font-medium text-slate-500">尚未配置费用方案</p><p className="mt-1 text-xs text-amber-600">出库费用和净利润将显示为未知</p></div>
              ) : schemes.map((scheme) => (
                <article key={scheme.id} className="rounded-xl border border-slate-100 p-3 dark:border-zinc-800">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold text-slate-800 dark:text-zinc-100">{scheme.name}</h3>{scheme.isDefault && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">默认</span>}{new Date(scheme.effectiveFrom).getTime() > Date.now() && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">未生效</span>}</div><p className="mt-1 text-[11px] text-slate-400">{scheme.saleMode || '未分类模式'}{scheme.category ? ` · ${scheme.category}` : ''}</p><p className="mt-1 text-[10px] text-slate-400">{new Date(scheme.effectiveFrom).toLocaleString('zh-CN')} 生效</p></div>
                    <div className="flex gap-1"><button onClick={() => beginEdit(scheme)} className="p-2 text-slate-400"><Pencil size={15} /></button><button onClick={() => void handleDelete(scheme)} className="p-2 text-red-400"><Trash2 size={15} /></button></div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-zinc-400">
                    <span>比例 {scheme.percentRate}% · {scheme.percentageUnit === 'item' ? '按件' : '按交易'}</span><span>固定 ¥{scheme.fixedFee} · {scheme.fixedFeeUnit === 'item' ? '按件' : '按交易'}</span>
                    <span>运费 ¥{scheme.shippingFee} · {scheme.shippingFeeUnit === 'item' ? '按件' : '按交易'}</span><span>其他 ¥{scheme.otherFee} · {scheme.otherFeeUnit === 'item' ? '按件' : '按交易'}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 text-xs text-slate-500">方案名称<input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如 得物普通出售" className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-dewu-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" /></label>
                <label className="text-xs text-slate-500">出售模式<input value={draft.saleMode} maxLength={60} onChange={(e) => setDraft({ ...draft, saleMode: e.target.value })} placeholder="普通出售" className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" /></label>
                <label className="text-xs text-slate-500">品类<input value={draft.category} maxLength={60} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="鞋类" className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" /></label>
              </div>

              <div className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-zinc-800/70">
                <div className="grid grid-cols-[1fr_148px] items-end gap-3"><label className="text-xs text-slate-500">比例费率 (%)<input type="number" min="0" max="100" step="0.01" value={draft.percentRate} onChange={(e) => updateNumber('percentRate', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" /></label><UnitToggle value={draft.percentageUnit} onChange={(value) => setDraft({ ...draft, percentageUnit: value })} /></div>
                <div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-500">比例费最低<input type="number" min="0" step="0.01" value={draft.percentMin ?? ''} onChange={(e) => updateNumber('percentMin', e.target.value, true)} placeholder="不设" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" /></label><label className="text-xs text-slate-500">比例费最高<input type="number" min="0" step="0.01" value={draft.percentMax ?? ''} onChange={(e) => updateNumber('percentMax', e.target.value, true)} placeholder="不设" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" /></label></div>
                {([['fixedFee','fixedFeeUnit','固定费'],['shippingFee','shippingFeeUnit','运费'],['otherFee','otherFeeUnit','其他费用']] as const).map(([amountKey, unitKey, label]) => <div key={amountKey} className="grid grid-cols-[1fr_148px] items-end gap-3"><label className="text-xs text-slate-500">{label}<input type="number" min="0" step="0.01" value={draft[amountKey]} onChange={(e) => updateNumber(amountKey, e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" /></label><UnitToggle value={draft[unitKey]} onChange={(value) => setDraft({ ...draft, [unitKey]: value })} /></div>)}
              </div>

              <label className="block text-xs text-slate-500">生效时间<input type="datetime-local" required value={toDateTimeLocalValue(draft.effectiveFrom)} onChange={(e) => setDraft({ ...draft, effectiveFrom: fromDateTimeLocalValue(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" /></label>
              <label className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm text-slate-600 dark:border-zinc-800 dark:text-zinc-300"><span>设为默认方案</span><input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} className="h-4 w-4 accent-teal-500" /></label>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
              <div className="grid grid-cols-2 gap-3"><button onClick={() => setIsEditing(false)} disabled={isSaving} className="rounded-xl bg-slate-100 py-3 text-sm font-medium text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">取消</button><button onClick={() => void handleSave()} disabled={isSaving} className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-dewu-600">{isSaving ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}保存</button></div>
            </div>
          )}
          {!isEditing && error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
        </div>
      </section>
    </div>
  );
};
