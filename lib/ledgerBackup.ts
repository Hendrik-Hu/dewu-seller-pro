export const LEDGER_BACKUP_SCHEMA_VERSION = 'dewu-seller-pro/ledger-backup@1' as const;

export interface LedgerBackupData {
  products: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
  warehouses: Array<Record<string, unknown>>;
  repairs: Array<Record<string, unknown>>;
}

export interface LedgerBackupPackage {
  schemaVersion: typeof LEDGER_BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  scope: 'full-ledger';
  counts: {
    products: number;
    activeProducts: number;
    recycledProducts: number;
    activities: number;
    warehouses: number;
    repairs: number;
  };
  media: {
    included: false;
    note: string;
  };
  data: LedgerBackupData;
  integrity: {
    algorithm: 'SHA-256';
    value: string;
  };
}

const sortForStableJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortForStableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortForStableJson(item)]));
  }
  return value;
};

export const stableStringify = (value: unknown) => JSON.stringify(sortForStableJson(value));

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const getUnsignedPackage = (backup: Omit<LedgerBackupPackage, 'integrity'> | LedgerBackupPackage) => {
  const { integrity: _integrity, ...unsigned } = backup as LedgerBackupPackage;
  return unsigned;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const assertRestoreLimits = (data: LedgerBackupData) => {
  if (data.products.length > 10000 || data.activities.length > 50000 || data.warehouses.length > 100 || data.repairs.length > 50000) {
    throw new Error('账本包超过恢复数量上限');
  }
  if (![...data.products, ...data.activities, ...data.warehouses, ...data.repairs].every(isRecord)) {
    throw new Error('账本包包含无法识别的记录');
  }
};

export const buildLedgerBackupPackage = async (data: LedgerBackupData, exportedAt = new Date().toISOString()): Promise<LedgerBackupPackage> => {
  assertRestoreLimits(data);
  const unsigned = {
    schemaVersion: LEDGER_BACKUP_SCHEMA_VERSION,
    exportedAt,
    scope: 'full-ledger' as const,
    counts: {
      products: data.products.length,
      activeProducts: data.products.filter((product) => !product.deletedAt).length,
      recycledProducts: data.products.filter((product) => Boolean(product.deletedAt)).length,
      activities: data.activities.length,
      warehouses: data.warehouses.length,
      repairs: data.repairs.length,
    },
    media: {
      included: false as const,
      note: '账本包不包含图片文件或临时签名链接；恢复后商品使用无图占位，原账号 Storage 图片不会被复制。',
    },
    data,
  };
  return {
    ...unsigned,
    integrity: { algorithm: 'SHA-256', value: await sha256(stableStringify(unsigned)) },
  };
};

export const parseLedgerBackupPackage = async (text: string): Promise<LedgerBackupPackage> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('账本包结构无效');
  const backup = parsed as LedgerBackupPackage;
  if (backup.schemaVersion !== LEDGER_BACKUP_SCHEMA_VERSION) throw new Error('不支持的账本包版本');
  if (backup.scope !== 'full-ledger') throw new Error('账本包范围无效');
  if (!backup.data || !Array.isArray(backup.data.products) || !Array.isArray(backup.data.activities) || !Array.isArray(backup.data.warehouses) || !Array.isArray(backup.data.repairs)) {
    throw new Error('账本包数据不完整');
  }
  assertRestoreLimits(backup.data);
  const expectedCounts = {
    products: backup.data.products.length,
    activeProducts: backup.data.products.filter((product) => !product.deletedAt).length,
    recycledProducts: backup.data.products.filter((product) => Boolean(product.deletedAt)).length,
    activities: backup.data.activities.length,
    warehouses: backup.data.warehouses.length,
    repairs: backup.data.repairs.length,
  };
  if (stableStringify(backup.counts) !== stableStringify(expectedCounts)) throw new Error('账本包计数校验失败');
  const actualHash = await sha256(stableStringify(getUnsignedPackage(backup)));
  if (backup.integrity?.algorithm !== 'SHA-256' || actualHash !== backup.integrity.value) throw new Error('账本包完整性校验失败');
  return backup;
};

export const serializeLedgerBackupPackage = (backup: LedgerBackupPackage) => `${JSON.stringify(backup, null, 2)}\n`;
