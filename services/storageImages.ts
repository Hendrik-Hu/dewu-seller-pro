import { Preferences } from '@capacitor/preferences';
import { supabase } from '../lib/supabase';

const PRODUCT_IMAGE_PREFIX = 'storage://product-images/';
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const CLEANUP_QUEUE_PREFIX = 'productImageCleanupQueueV1';
const cleanupQueueKey = (userId: string) => `${CLEANUP_QUEUE_PREFIX}:${userId}`;

export const createProductImageRef = (path: string) => `${PRODUCT_IMAGE_PREFIX}${path}`;

export const isProductImageRef = (value?: string): boolean =>
  Boolean(value?.startsWith(PRODUCT_IMAGE_PREFIX));

const getOwnedProductImagePath = (userId: string, value?: string) => {
  if (!isProductImageRef(value)) return null;
  const path = value!.slice(PRODUCT_IMAGE_PREFIX.length);
  return path.startsWith(`${userId}/`) ? path : null;
};

const sha256Hex = async (file: File) => {
  if (!globalThis.crypto?.subtle) throw new Error('当前设备不支持安全图片上传');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const uploadImmutableProductImage = async (userId: string, sku: string, file: File) => {
  const hash = await sha256Hex(file);
  const safeSku = (sku || 'product').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const path = `${userId}/products/${safeSku}/${hash}.jpg`;
  const { error } = await supabase.storage.from('product-images').upload(path, file, {
    upsert: false,
    contentType: 'image/jpeg',
    cacheControl: '31536000',
  });
  if (error && !(/already exists|duplicate/i.test(error.message || '') || String((error as any).statusCode) === '409')) {
    throw error;
  }
  return createProductImageRef(path);
};

const isProductImageReferenced = async (userId: string, value: string) => {
  const [productsResult, activitiesResult] = await Promise.all([
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('image_url', value),
    supabase.from('activities').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('image_url', value),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (activitiesResult.error) throw activitiesResult.error;
  return Number(productsResult.count || 0) > 0 || Number(activitiesResult.count || 0) > 0;
};

export const removeProductImageRefIfUnreferenced = async (userId: string, value?: string) => {
  const path = getOwnedProductImagePath(userId, value);
  if (!path || !value) return { removed: false, reason: 'not-owned' as const };
  if (await isProductImageReferenced(userId, value)) return { removed: false, reason: 'referenced' as const };
  const { error } = await supabase.storage.from('product-images').remove([path]);
  if (error) throw error;
  signedUrlCache.delete(value);
  return { removed: true, reason: 'unreferenced' as const };
};

const readCleanupQueue = async (userId: string): Promise<string[]> => {
  const { value } = await Preferences.get({ key: cleanupQueueKey(userId) });
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(-50) : [];
  } catch {
    return [];
  }
};

export const enqueueProductImageCleanup = async (userId: string, value?: string) => {
  if (!getOwnedProductImagePath(userId, value) || !value) return;
  const queue = await readCleanupQueue(userId);
  const next = [...new Set([...queue, value])].slice(-50);
  await Preferences.set({ key: cleanupQueueKey(userId), value: JSON.stringify(next) });
};

export const clearProductImageCleanupQueue = (userId: string) =>
  Preferences.remove({ key: cleanupQueueKey(userId) });

export const processProductImageCleanupQueue = async (userId: string) => {
  const queue = await readCleanupQueue(userId);
  const retry: string[] = [];
  for (const value of queue) {
    try {
      await removeProductImageRefIfUnreferenced(userId, value);
    } catch (error) {
      console.warn('Product image cleanup deferred.', error);
      retry.push(value);
    }
  }
  if (retry.length > 0) {
    await Preferences.set({ key: cleanupQueueKey(userId), value: JSON.stringify(retry) });
  } else {
    await Preferences.remove({ key: cleanupQueueKey(userId) });
  }
  return { checked: queue.length, deferred: retry.length };
};

export const resolveStorageImageUrl = async (value?: string): Promise<string> => {
  if (!isProductImageRef(value)) return value || '';

  const cached = signedUrlCache.get(value!);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const path = value!.slice(PRODUCT_IMAGE_PREFIX.length);
  const { data, error } = await supabase.storage
    .from('product-images')
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.warn('Failed to create product image URL', error);
    return '';
  }

  signedUrlCache.set(value!, {
    url: data.signedUrl,
    expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - 300) * 1000,
  });
  return data.signedUrl;
};
