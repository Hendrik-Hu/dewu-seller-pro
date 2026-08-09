export const NATIVE_RECOVERY_REDIRECT = 'com.hendrikhu.sellerinventory://auth/recovery';

export interface RecoveryUrlPayload {
  code?: string;
  accessToken?: string;
  refreshToken?: string;
}

export const parseRecoveryUrl = (rawUrl: string): RecoveryUrlPayload | null => {
  try {
    const url = new URL(rawUrl);
    const isNative = url.protocol === 'com.hendrikhu.sellerinventory:' && url.host === 'auth' && url.pathname === '/recovery';
    const isWeb = (url.protocol === 'https:' || url.protocol === 'http:') && url.pathname === '/auth/recovery';
    if (!isNative && !isWeb) return null;
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const code = url.searchParams.get('code') || undefined;
    const accessToken = hash.get('access_token') || undefined;
    const refreshToken = hash.get('refresh_token') || undefined;
    if (!code && (!accessToken || !refreshToken)) return null;
    return { code, accessToken, refreshToken };
  } catch {
    return null;
  }
};

