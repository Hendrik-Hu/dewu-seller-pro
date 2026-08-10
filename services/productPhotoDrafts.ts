import { Preferences } from '@capacitor/preferences';

const DB_NAME = 'seller-inventory-photo-drafts-v1';
const STORE_NAME = 'photos';
const DB_VERSION = 1;
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

interface StoredPhotoDraft {
  key: string;
  userId: string;
  draftId: string;
  blob: Blob;
  fileName: string;
  type: string;
  updatedAt: number;
}

const requireIndexedDb = () => {
  if (!globalThis.indexedDB) throw new Error('当前设备无法持久保存照片草稿');
  return globalThis.indexedDB;
};

const openPhotoDraftDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = requireIndexedDb().open(DB_NAME, DB_VERSION);
  request.onerror = () => reject(request.error || new Error('照片草稿数据库打开失败'));
  request.onblocked = () => reject(new Error('照片草稿数据库正在被占用，请关闭其他页面后重试'));
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      store.createIndex('userId', 'userId', { unique: false });
      store.createIndex('updatedAt', 'updatedAt', { unique: false });
    }
  };
  request.onsuccess = () => resolve(request.result);
});

const draftKey = (userId: string, draftId: string) => `${userId}:${draftId}`;

const withStore = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => {
  const db = await openPhotoDraftDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onerror = () => reject(request.error || new Error('照片草稿操作失败'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error || new Error('照片草稿事务失败'));
      transaction.onabort = () => reject(transaction.error || new Error('照片草稿事务失败'));
    });
  } finally {
    db.close();
  }
};

export const saveProductPhotoDraft = async (userId: string, draftId: string, file: File) => {
  const record: StoredPhotoDraft = {
    key: draftKey(userId, draftId),
    userId,
    draftId,
    blob: file,
    fileName: file.name,
    type: file.type,
    updatedAt: Date.now(),
  };
  await withStore('readwrite', (store) => store.put(record));
};

export const loadProductPhotoDraft = async (userId: string, draftId?: string): Promise<File | null> => {
  if (!draftId) return null;
  const record = await withStore<StoredPhotoDraft | undefined>('readonly', (store) => store.get(draftKey(userId, draftId)));
  if (!record || record.userId !== userId || record.draftId !== draftId) return null;
  return new File([record.blob], record.fileName || 'product.jpg', { type: record.type || record.blob.type || 'image/jpeg' });
};

export const deleteProductPhotoDraft = async (userId: string, draftId?: string) => {
  if (!draftId) return;
  await withStore('readwrite', (store) => store.delete(draftKey(userId, draftId)));
};

export const deleteAllProductPhotoDraftData = async (userId: string) => {
  const db = await openPhotoDraftDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const index = transaction.objectStore(STORE_NAME).index('userId');
      const request = index.openCursor(IDBKeyRange.only(userId));
      request.onerror = () => reject(request.error || new Error('照片草稿清理失败'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('照片草稿清理失败'));
      transaction.onabort = () => reject(transaction.error || new Error('照片草稿清理失败'));
    });
  } finally {
    db.close();
  }
  await Preferences.remove({ key: `addProductDraftV2:${userId}` });
};

export const pruneProductPhotoDrafts = async (userId: string, keepDraftIds: string[] = []) => {
  const keep = new Set(keepDraftIds);
  const db = await openPhotoDraftDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const index = transaction.objectStore(STORE_NAME).index('userId');
      const request = index.openCursor(IDBKeyRange.only(userId));
      request.onerror = () => reject(request.error || new Error('照片草稿清理失败'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const record = cursor.value as StoredPhotoDraft;
        if (!keep.has(record.draftId) && Date.now() - record.updatedAt > STALE_AFTER_MS) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('照片草稿清理失败'));
      transaction.onabort = () => reject(transaction.error || new Error('照片草稿清理失败'));
    });
  } finally {
    db.close();
  }
};
