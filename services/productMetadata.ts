import { Preferences } from '@capacitor/preferences';
import { Product } from '../types';

const PRODUCT_METADATA_PREFIX = 'product_metadata';

const getMetadataKey = (userId: string) => `${PRODUCT_METADATA_PREFIX}:${userId}`;

export const mergeProductsWithLocalMetadata = async (userId: string, products: Product[]) => {
  await Preferences.remove({ key: getMetadataKey(userId) }).catch(() => {});
  return products.map((product) => ({ ...product, source: product.source || '' }));
};
