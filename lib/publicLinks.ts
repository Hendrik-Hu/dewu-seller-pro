import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

const configuredPublicSite = String(import.meta.env.VITE_PUBLIC_SITE_URL || '').replace(/\/$/, '');
const publicSiteBase = configuredPublicSite || window.location.origin.replace(/\/$/, '');

if (Capacitor.isNativePlatform() && !/^https:\/\//i.test(configuredPublicSite)) {
  throw new Error('Android build is missing a verified HTTPS VITE_PUBLIC_SITE_URL.');
}

export const PUBLIC_LINKS = {
  privacy: `${publicSiteBase}/privacy.html`,
  accountDeletion: `${publicSiteBase}/account-deletion.html`,
  passwordRecovery: `${publicSiteBase}/auth/recovery`,
  emailConfirmation: `${publicSiteBase}/auth/confirm`,
  support: 'https://github.com/Hendrik-Hu/dewu-seller-pro/issues',
} as const;

export const openExternalUrl = async (url: string) => {
  await Browser.open({ url });
};
