import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, History, Loader2, ShieldCheck, X } from 'lucide-react';
import { formatProductSize } from '../lib/productNormalization';
import { validateDataRepairInput } from '../lib/dataHealthValidation';
import {
  DataHealthIssue,
  DataRepairAudit,
  listDataHealthIssues,
  listDataRepairAudit,
  repairOrphanProductWarehouse,
  repairDataHealthIssue,
} from '../services/dataHealth';
import { listWarehouses } from '../services/warehouses';
import { Warehouse } from '../types';

interface DataHealthModalProps {
  isOpen: boolean;
  userId: string;
  onClose: () => void;
  onRepaired: () => void;
}

export const DataHealthModal: React.FC<DataHealthModalProps> = ({ isOpen, userId, onClose, onRepaired }) => {
  const [issues, setIssues] = useState<DataHealthIssue[]>([]);
  const [audit, setAudit] = useState<DataRepairAudit[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [view, setView] = useState<'issues' | 'history'>('issues');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');
  const [targetStatus, setTargetStatus] = useState<DataHealthIssue['status'] | ''>('');
  const [targetWarehouseId, setTargetWarehouseId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextIssues, nextAudit, nextWarehouses] = await Promise.all([
        listDataHealthIssues(userId),
        listDataRepairAudit(userId),
        listWarehouses(userId),
      ]);
      setIssues(nextIssues);
      setAudit(nextAudit);
      setWarehouses(nextWarehouses);
    } catch (err: any) {
      setError(err?.message || '数据体检加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) refresh();
  }, [isOpen, userId]);

  const startRepair = (issue: DataHealthIssue) => {
    setEditingId(`${issue.issueType}:${issue.table}:${issue.id}`);
    setNewValue('');
    setReason('');
    setTargetStatus('');
    setTargetWarehouseId('');
    setError('');
  };

  const submitRepair = async (issue: DataHealthIssue) => {
    if (issue.issueType === 'orphan_warehouse') {
      if (!targetWarehouseId) {
        setError('请选择核对后的目标仓库');
        return;
      }
      if (reason.trim().length < 3) {
        setError('请填写核对依据');
        return;
      }
      const target = warehouses.find((warehouse) => warehouse.id === targetWarehouseId);
      if (!target) {
        setError('目标仓库已不存在，请重新选择');
        return;
      }
      if (!window.confirm(`确认把“${issue.warehouse}”下的这条库存归入“${target.name}”？数量和状态不会改变，并会写入审计记录。`)) return;
      setSaving(true);
      setError('');
      try {
        await repairOrphanProductWarehouse(userId, issue.id, targetWarehouseId, reason.trim());
        setEditingId(null);
        setTargetWarehouseId('');
        setReason('');
        await refresh();
        onRepaired();
      } catch (err: any) {
        setError(err?.message || '仓库修复失败');
      } finally {
        setSaving(false);
      }
      return;
    }

    const validation = validateDataRepairInput(issue.table, newValue, reason, targetStatus);
    if (validation.error || validation.value == null) {
      setError(validation.error || '请检查修正内容');
      return;
    }
    const value = validation.value;
    const statusText = issue.table === 'products' ? `，状态改为“${statusLabel(targetStatus)}”` : '';
    if (!window.confirm(`确认把原值 ${issue.value} 修正为 ${value}${statusText}？这会改变经营统计，并写入审计记录。`)) return;

    setSaving(true);
    setError('');
    try {
      await repairDataHealthIssue(userId, issue, value, reason.trim(), targetStatus || undefined);
      setEditingId(null);
      setNewValue('');
      setReason('');
      setTargetStatus('');
      setTargetWarehouseId('');
      await refresh();
      onRepaired();
    } catch (err: any) {
      setError(err?.message || '修正失败');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  function statusLabel(status?: string) {
    return ({ instock: '在售', shipping: '运输中', sold: '已售罄', flaw: '瑕疵' } as Record<string, string>)[status || ''] || '未设置';
  }

  function activityTypeLabel(type?: string) {
    return ({ inbound: '入库', outbound: '出库', pending: '待发货', restore: '恢复', transfer: '调拨' } as Record<string, string>)[type || ''] || type || '未知类型';
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex h-[82vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-50 p-2 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white">数据体检</h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400">异常记录不计入经营统计</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800" aria-label="关闭">
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-2 border-b border-slate-100 p-3 dark:border-zinc-800">
          <button onClick={() => setView('issues')} className={`py-2 text-sm font-medium ${view === 'issues' ? 'text-amber-600' : 'text-slate-400'}`}>
            待核对 {issues.length}
          </button>
          <button onClick={() => setView('history')} className={`py-2 text-sm font-medium ${view === 'history' ? 'text-cyan-600' : 'text-slate-400'}`}>
            修复记录 {audit.length}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50 p-4 dark:bg-black/40">
          {loading ? (
            <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>
          ) : error && issues.length === 0 && audit.length === 0 ? (
            <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">{error}</div>
          ) : view === 'issues' ? (
            issues.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <CheckCircle2 size={36} className="mb-3 text-emerald-500" />
                <p className="font-medium text-slate-700 dark:text-zinc-200">当前没有待核对异常</p>
              </div>
            ) : (
              <div className="space-y-3">
                {issues.map((issue) => {
                  const key = `${issue.issueType}:${issue.table}:${issue.id}`;
                  const isEditing = editingId === key;
                  return (
                    <div key={key} className="rounded-lg border border-amber-100 bg-white p-3 dark:border-amber-900/30 dark:bg-zinc-900">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <AlertTriangle size={15} className="shrink-0 text-amber-500" />
                            <span className="font-semibold text-slate-800 dark:text-zinc-100">{issue.productName || issue.sku || '未命名记录'}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-600 dark:text-zinc-300">{issue.sku || '无货号'} · {formatProductSize(issue.size)} · {issue.warehouse}</p>
                          <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                            {issue.issueType === 'orphan_warehouse'
                              ? '异常类型：仓库不存在'
                              : issue.table === 'products'
                                ? '异常类型：负库存'
                                : '异常类型：非正数流水'} · {issue.issueType === 'orphan_warehouse' ? `当前库存 ${issue.value}` : `原值 ${issue.value}`}
                          </p>
                          {issue.table === 'products' ? (
                            <p className="mt-1 text-xs text-slate-500">当前状态：{statusLabel(issue.status)}</p>
                          ) : (
                            <p className="mt-1 text-xs text-slate-500">
                              {activityTypeLabel(issue.activityType)} · 售价 ¥{issue.price ?? 0} · 成本 ¥{issue.cost ?? 0}
                            </p>
                          )}
                          <p className="mt-1 break-all text-[10px] text-slate-400">{issue.table} / {issue.id}</p>
                          <p className="mt-1 text-[10px] text-slate-400">{issue.createdAt ? new Date(issue.createdAt).toLocaleString('zh-CN') : '时间未知'}</p>
                          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{issue.suggestion}</p>
                          <p className="mt-1 text-[11px] text-red-500">
                            {issue.issueType === 'orphan_warehouse'
                              ? '当前记录无法在仓库列表中查看；修复只更正仓库归属，不改变库存数量。'
                              : '当前记录已从正常库存和经营统计中排除；修正后统计会重新计算。'}
                          </p>
                        </div>
                        {!isEditing && <button onClick={() => startRepair(issue)} className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white dark:bg-cyan-600">核对修正</button>}
                      </div>
                      {isEditing && (
                        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-zinc-800">
                          {issue.issueType === 'orphan_warehouse' ? (
                            <select value={targetWarehouseId} onChange={(event) => setTargetWarehouseId(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" aria-label="核对后的目标仓库">
                              <option value="">选择核对后的目标仓库</option>
                              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.is_default ? '（主仓）' : ''}</option>)}
                            </select>
                          ) : <input type="number" step="1" min={issue.table === 'products' ? 0 : 1} value={newValue} onChange={(event) => {
                            setNewValue(event.target.value);
                            setTargetStatus('');
                          }} placeholder={issue.table === 'products' ? '填写核对后的实际库存' : '填写核对后的流水数量'} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" aria-label="修正后的数量" />}
                          {issue.table === 'products' && issue.issueType !== 'orphan_warehouse' && (
                            <select disabled={!newValue.trim()} value={targetStatus} onChange={(event) => setTargetStatus(event.target.value as DataHealthIssue['status'] | '')} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:disabled:bg-zinc-900" aria-label="修正后的商品状态">
                              <option value="">{newValue.trim() ? '选择修正后的商品状态' : '请先填写实际库存'}</option>
                              {newValue.trim() && Number(newValue) === 0 ? (
                                <option value="sold">已售罄</option>
                              ) : newValue.trim() ? (
                                <>
                                  <option value="instock">在售</option>
                                  <option value="shipping">运输中</option>
                                  <option value="flaw">瑕疵</option>
                                </>
                              ) : null}
                            </select>
                          )}
                          <input value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="核对依据" aria-label="核对依据" />
                          {error && <p className="text-xs text-red-500">{error}</p>}
                          <div className="flex gap-2">
                            <button onClick={() => setEditingId(null)} className="flex-1 rounded-lg bg-slate-100 py-2 text-xs text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">取消</button>
                            <button onClick={() => submitRepair(issue)} disabled={saving} className="flex-1 rounded-lg bg-amber-500 py-2 text-xs font-medium text-white disabled:opacity-50">{saving ? '正在修正' : '确认修正'}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : audit.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-slate-400"><History size={34} className="mb-3" /><p>暂无修复记录</p></div>
          ) : (
            <div className="space-y-2">
              {audit.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-100 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="font-medium text-slate-700 dark:text-zinc-200">{item.targetTable} / {item.recordId}</div>
                  <div className="mt-1 text-slate-500">{item.isWarehouseRepair ? item.reason : `${item.oldValue} → ${item.newValue} · ${item.reason}`}</div>
                  {!item.isWarehouseRepair && (item.oldStatus || item.newStatus) && <div className="mt-1 text-slate-500">状态：{statusLabel(item.oldStatus)} → {statusLabel(item.newStatus)}</div>}
                  <div className="mt-1 text-[10px] text-slate-400">{new Date(item.createdAt).toLocaleString('zh-CN')}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
