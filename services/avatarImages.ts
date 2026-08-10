import { supabase } from '../lib/supabase';

const BUCKET = 'avatars';
const STORAGE_ORIGIN = 'https://vitgaeirmnbvgwrpofmf.supabase.co';

const sha256Hex = async (file: File) => {
  if (!globalThis.crypto?.subtle) throw new Error('当前设备不支持安全头像上传');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const uploadImmutableAvatar = async (userId: string, file: File) => {
  if (file.type !== 'image/jpeg' || file.size <= 0 || file.size > 512 * 1024) {
    throw new Error('头像必须是压缩后的 JPEG，且不能超过 512 KB');
  }
  const hash = await sha256Hex(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const { data, error } = await supabase.functions.invoke('upload-avatar', {
    body: { contentBase64: btoa(binary), sha256: hash },
  });
  if (error) throw error;
  const path = typeof data?.path === 'string' ? data.path : '';
  const publicUrl = typeof data?.publicUrl === 'string' ? data.publicUrl : '';
  if (
    !path.startsWith(`${userId}/avatars/`)
    || getOwnedAvatarPath(userId, publicUrl) !== path
    || typeof data?.created !== 'boolean'
  ) {
    throw new Error('头像服务返回了无效结果');
  }
  return { path, publicUrl, created: data.created as boolean };
};

export const getOwnedAvatarPath = (userId: string, publicUrl?: string) => {
  if (!publicUrl) return null;
  try {
    const url = new URL(publicUrl);
    if (url.origin !== STORAGE_ORIGIN) return null;
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const path = decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    return path.startsWith(`${userId}/avatars/`) ? path : null;
  } catch {
    return null;
  }
};

export const removeOwnedAvatar = async (userId: string, pathOrUrl?: string) => {
  const path = pathOrUrl?.startsWith(`${userId}/avatars/`)
    ? pathOrUrl
    : getOwnedAvatarPath(userId, pathOrUrl);
  if (!path) return false;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
  return true;
};
