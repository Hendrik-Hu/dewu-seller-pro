import { Preferences } from '@capacitor/preferences';
import { Product } from '../types';

const PRODUCT_METADATA_PREFIX = 'product_metadata';

interface ProductLocalMetadata {
  source?: string;
}

const getMetadataKey = (userId: string) => `${PRODUCT_METADATA_PREFIX}:${userId}`;

const readMetadataMap = async (userId: string): Promise<Record<string, ProductLocalMetadata>> => {
  try {
    const { value } = await Preferences.get({ key: getMetadataKey(userId) });
    return value ? JSON.parse(value) : {};
  } catch (error) {
    console.error('Failed to read product metadata:', error);
    return {};
  }
};

const writeMetadataMap = async (userId: string, metadata: Record<string, ProductLocalMetadata>) => {
  await Preferences.set({
    key: getMetadataKey(userId),
    value: JSON.stringify(metadata),
  });
};

export const mergeProductsWithLocalMetadata = async (userId: string, products: Product[]) => {
  const metadata = await readMetadataMap(userId);
  return products.map((product) => ({
    ...product,
    source: metadata[product.id]?.source || product.source || '',
  }));
};

export const saveProductLocalMetadata = async (userId: string, product: Product) => {
  const metadata = await readMetadataMap(userId);
  metadata[product.id] = {
    ...metadata[product.id],
    source: product.source || '',
  };
  await writeMetadataMap(userId, metadata);
};

export const deleteProductLocalMetadata = async (userId: string, productId: string) => {
  const metadata = await readMetadataMap(userId);
  delete metadata[productId];
  await writeMetadataMap(userId, metadata);
};
