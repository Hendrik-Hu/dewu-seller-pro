export interface ConfirmationUrlPayload {
  code?: string;
  accessToken?: string;
  refreshToken?: string;
}

export const parseConfirmationUrl = (rawUrl: string): ConfirmationUrlPayload | null => {
  try {
    const url = new URL(rawUrl);
    const isWeb = url.protocol === 'https:' && url.pathname === '/auth/confirm';
    if (!isWeb) return null;
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const type = hash.get('type');
    if (type && type !== 'signup' && type !== 'email_change') return null;
    const code = url.searchParams.get('code') || undefined;
    const accessToken = hash.get('access_token') || undefined;
    const refreshToken = hash.get('refresh_token') || undefined;
    if (!code && (!accessToken || !refreshToken)) return null;
    return { code, accessToken, refreshToken };
  } catch {
    return null;
  }
};
