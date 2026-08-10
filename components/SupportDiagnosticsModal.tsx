import React, { useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { AlertTriangle, Check, Clipboard, Download, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';

import { APP_NAME } from '../lib/brand';
import { openExternalUrl, PUBLIC_LINKS } from '../lib/publicLinks';
import {
  buildPublicSupportIssueUrl,
  buildSupportDiagnosticReport,
  probeSupportServices,
  ServiceHealthResult,
  SupportDiagnosticReport,
  SupportDiagnosticState,
} from '../lib/supportDiagnostics';

interface SupportDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appVersion: string;
  diagnosticState: SupportDiagnosticState;
}

const uncheckedHealth = (): ServiceHealthResult => ({ status: 'not_checked', checkedAt: new Date().toISOString() });
const readOnlineState = () => import.meta.env.DEV && new URLSearchParams(window.location.search).get('diagnostic-preview') === 'offline'
  ? false
  : navigator.onLine;

export const SupportDiagnosticsModal: React.FC<SupportDiagnosticsModalProps> = ({
  isOpen,
  onClose,
  appVersion,
  diagnosticState,
}) => {
  const [online, setOnline] = useState(readOnlineState);
  const [checking, setChecking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const [health, setHealth] = useState(() => ({ appAssets: uncheckedHealth(), identityService: uncheckedHealth() }));
  const [diagnosticId] = useState(() => buildSupportDiagnosticReport({
    state: diagnosticState,
    appName: APP_NAME,
    appVersion,
    runtime: Capacitor.getPlatform() as 'web' | 'android' | 'ios',
    online: readOnlineState(),
    appAssets: uncheckedHealth(),
    identityService: uncheckedHealth(),
  }).diagnosticId);

  useEffect(() => {
    if (!isOpen) return;
    const updateOnline = () => setOnline(readOnlineState());
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setConfirmed(false);
    setNotice('');
  }, [isOpen]);

  const refreshHealth = async () => {
    setChecking(true);
    setNotice('');
    const currentOnline = readOnlineState();
    setOnline(currentOnline);
    setHealth(await probeSupportServices(currentOnline));
    setChecking(false);
  };

  useEffect(() => {
    if (isOpen) void refreshHealth();
  }, [isOpen]);

  const report: SupportDiagnosticReport = useMemo(() => buildSupportDiagnosticReport({
    state: diagnosticState,
    appName: APP_NAME,
    appVersion,
    runtime: Capacitor.getPlatform() as 'web' | 'android' | 'ios',
    online,
    appAssets: health.appAssets,
    identityService: health.identityService,
    diagnosticId,
  }), [appVersion, diagnosticId, diagnosticState, health, online]);
  const reportText = useMemo(() => JSON.stringify(report, null, 2), [report]);

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setNotice('诊断内容已复制');
    } catch {
      setNotice('复制失败，可使用“导出 JSON”保存');
    }
  };

  const exportReport = () => {
    const url = URL.createObjectURL(new Blob([reportText], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `seller-inventory-diagnostic-${report.diagnosticId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice('诊断 JSON 已导出');
  };

  const openIssue = async () => {
    if (!confirmed || !online) return;
    await openExternalUrl(buildPublicSupportIssueUrl(PUBLIC_LINKS.support, appVersion, report.diagnosticId));
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-[95] flex items-end justify-center bg-slate-100 p-3 dark:bg-black sm:items-center sm:bg-slate-950/50 sm:backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="support-title">
      <div className="flex max-h-[calc(100%-1rem)] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-zinc-800">
          <div>
            <h2 id="support-title" className="text-base font-bold text-slate-900 dark:text-white">支持与安全诊断</h2>
            <p className="mt-0.5 text-xs text-slate-400">先检查内容，再决定是否前往公开社区</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭支持与安全诊断" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 active:bg-slate-100 dark:active:bg-zinc-800"><X size={19} /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
            <div className="mb-1 flex items-center gap-2 font-bold"><AlertTriangle size={16} />公开求助前请先脱敏</div>
            <p>不要上传密码、令牌、邮箱、订单号、库存明细、仓库信息、财务数据或未经打码的截图。</p>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100">最小诊断内容</h3>
                <p className="text-[11px] text-slate-400">仅含版本、平台、服务状态和匿名诊断编号</p>
              </div>
              <button type="button" onClick={refreshHealth} disabled={checking} className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-[11px] font-semibold text-slate-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
                {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}检测
              </button>
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 text-[10px] leading-4 text-emerald-200" aria-label="诊断 JSON 预览">{reportText}</pre>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={copyReport} className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 dark:border-zinc-700 dark:text-zinc-200"><Clipboard size={15} />复制内容</button>
              <button type="button" onClick={exportReport} className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 dark:border-zinc-700 dark:text-zinc-200"><Download size={15} />导出 JSON</button>
            </div>
            {notice && <p className="text-center text-xs text-dewu-600 dark:text-dewu-300" role="status">{notice}</p>}
          </section>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-emerald-500" />
            <span>我已预览诊断内容，并会在公开 Issue 中继续保护账号、订单、库存和财务隐私。</span>
          </label>
        </div>

        <footer className="shrink-0 border-t border-slate-100 p-4 dark:border-zinc-800">
          <button type="button" onClick={openIssue} disabled={!confirmed || !online} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-dewu-500 dark:text-slate-950">
            {confirmed && online ? <ExternalLink size={16} /> : <Check size={16} />}
            {!online ? '当前离线，可先导出诊断' : '确认后前往公开支持'}
          </button>
        </footer>
      </div>
    </div>
  );
};
