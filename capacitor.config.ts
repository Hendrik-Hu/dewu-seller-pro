import type { CapacitorConfig } from '@capacitor/cli';
import { loadEnv } from 'vite';

const loadedEnv = loadEnv(process.env.NODE_ENV || 'production', process.cwd(), '');
const publicSiteUrl = String(process.env.VITE_PUBLIC_SITE_URL || loadedEnv.VITE_PUBLIC_SITE_URL || '');
if (!/^https:\/\/[^/]+/i.test(publicSiteUrl)) {
  throw new Error('Android sync requires VITE_PUBLIC_SITE_URL to be a verified HTTPS origin.');
}

const config: CapacitorConfig = {
  appId: 'com.hendrikhu.sellerinventory',
  appName: '卖家库存助手',
  webDir: 'dist'
};

export default config;
