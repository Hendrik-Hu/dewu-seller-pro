import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@app-entry';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { recoverFromDynamicImportFailure } from './lib/chunkRecovery';
import './index.css';

window.addEventListener('vite:preloadError', (event) => {
  const preloadError = event as Event & { payload?: unknown };
  const recovery = recoverFromDynamicImportFailure(preloadError.payload);
  if (recovery !== 'not-chunk-error') event.preventDefault();
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <AppErrorBoundary>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </AppErrorBoundary>
);
