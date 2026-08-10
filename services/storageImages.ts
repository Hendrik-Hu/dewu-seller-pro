import { supabase } from '../lib/supabase';

const PRODUCT_IMAGE_PREFIX = 'storage://product-images/';
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export const createProductImageRef = (path: string) => `${PRODUCT_IMAGE_PREFIX}${path}`;

export const isProductImageRef = (value?: string): boolean =>
  Boolean(value?.startsWith(PRODUCT_IMAGE_PREFIX));

export const removeProductImageRef = async (value?: string) => {
  if (!isProductImageRef(value)) return;
  const path = value!.slice(PRODUCT_IMAGE_PREFIX.length);
  const { error } = await supabase.storage.from('product-images').remove([path]);
  if (error) throw error;
  signedUrlCache.delete(value!);
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
