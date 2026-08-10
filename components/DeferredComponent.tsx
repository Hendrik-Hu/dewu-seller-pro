import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw, X } from 'lucide-react';

type DeferredKind = 'page' | 'modal';

interface DeferredOptions {
  label: string;
  kind: DeferredKind;
}

export const createDeferredComponent = <TProps extends object>(
  importer: () => Promise<React.ComponentType<TProps>>,
  options: DeferredOptions,
): React.FC<TProps> => {
  let cachedComponent: React.ComponentType<TProps> | null = null;
  let pendingImport: Promise<React.ComponentType<TProps>> | null = null;

  const loadComponent = () => {
    if (cachedComponent) return Promise.resolve(cachedComponent);
    if (!pendingImport) {
      pendingImport = importer()
        .then((component) => {
          cachedComponent = component;
          return component;
        })
        .catch((error) => {
          pendingImport = null;
          throw error;
        });
    }
    return pendingImport;
  };

  const DeferredComponent: React.FC<TProps> = (props) => {
    const [component, setComponent] = useState<React.ComponentType<TProps> | null>(() => cachedComponent);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
      if (component) return;
      let active = true;
      setError('');
      loadComponent()
        .then((loaded) => {
          if (active) setComponent(() => loaded);
        })
        .catch(() => {
          if (active) setError(`${options.label}加载失败，现有数据没有被清空。`);
        });
      return () => {
        active = false;
      };
    }, [attempt, component]);

    if (component) {
      const LoadedComponent = component;
      return <LoadedComponent {...props} />;
    }

    const retry = () => {
      setError('');
      setAttempt((value) => value + 1);
    };
    const dismiss = (props as TProps & { onClose?: () => void }).onClose;
    const content = error ? (
      <div className="flex max-w-xs flex-col items-center text-center" role="alert">
        <p className="text-sm font-semibold text-slate-800 dark:text-zinc-100">{error}</p>
        <div className="mt-4 flex items-center gap-2">
          {dismiss && (
            <button type="button" onClick={dismiss} className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-500 dark:border-zinc-700 dark:text-zinc-300">
              <X size={15} />关闭
            </button>
          )}
          <button type="button" onClick={retry} className="flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white dark:bg-white dark:text-black">
            <RefreshCw size={15} />重新加载
          </button>
        </div>
      </div>
    ) : (
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-zinc-400" role="status" aria-live="polite">
        <Loader2 size={18} className="animate-spin text-dewu-500" />正在加载{options.label}...
      </div>
    );

    if (options.kind === 'page') {
      return (
        <div className="flex h-full min-h-[320px] items-center justify-center bg-slate-50 px-6 pb-24 dark:bg-black" aria-busy={!error}>
          {content}
        </div>
      );
    }

    return (
      <div className="absolute inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-5 backdrop-blur-sm" aria-busy={!error}>
        <div className="flex min-h-32 w-full max-w-xs items-center justify-center rounded-xl border border-slate-100 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
          {content}
        </div>
      </div>
    );
  };

  DeferredComponent.displayName = `Deferred(${options.label})`;
  return DeferredComponent;
};
