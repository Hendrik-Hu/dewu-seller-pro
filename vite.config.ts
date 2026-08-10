import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export default defineConfig(({ command }) => {
  const buildTarget = process.env.SELLER_INVENTORY_BUILD_TARGET || (command === 'serve' ? 'app' : 'web-support');
  if (!['app', 'android', 'web-support'].includes(buildTarget)) {
    throw new Error(`Unsupported SELLER_INVENTORY_BUILD_TARGET: ${buildTarget}`);
  }
  const isWebSupport = buildTarget === 'web-support';

  return {
      base: isWebSupport ? '/' : './',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'android-only-product-surface',
          transformIndexHtml(html: string) {
            if (!isWebSupport) return html;
            return html
              .replace(/\s*<link rel="manifest"[^>]*>/i, '')
              .replace(/\s*<meta name="apple-mobile-web-app-capable"[^>]*>/i, '')
              .replace(/\s*<meta name="apple-mobile-web-app-status-bar-style"[^>]*>/i, '');
          },
        },
      ],
      define: {
        __APP_VERSION__: JSON.stringify(packageVersion),
        __BUILD_TARGET__: JSON.stringify(buildTarget),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          '@app-entry': path.resolve(__dirname, isWebSupport ? 'WebSupportApp.tsx' : 'App.tsx'),
        }
      },
      build: {
        manifest: true,
        rollupOptions: {
          output: {
            manualChunks: {
              supabase: ['@supabase/supabase-js'],
            },
          },
        },
      },
  };
});
