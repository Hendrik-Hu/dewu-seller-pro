import React from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

interface AppErrorBoundaryState {
  hasError: boolean;
}

interface AppErrorBoundaryProps {
  children?: React.ReactNode;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.error('App render failed', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="h-full bg-slate-50 px-6 flex items-center justify-center">
        <section className="w-full max-w-sm text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-lg bg-red-50 text-red-500 flex items-center justify-center">
            <TriangleAlert size={24} />
          </div>
          <h1 className="text-lg font-bold text-slate-900">页面暂时无法加载</h1>
          <p className="mt-2 text-sm text-slate-500">库存数据不会受到影响，请重新加载后继续。</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
          >
            <RefreshCw size={16} />
            重新加载
          </button>
        </section>
      </main>
    );
  }
}
