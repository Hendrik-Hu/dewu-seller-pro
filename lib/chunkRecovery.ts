const CHUNK_RECOVERY_PREFIX = 'seller_inventory_chunk_recovery_v1:';
const RECENT_CHUNK_FAILURE_WINDOW_MS = 5_000;
let latestDynamicImportFailureAt = 0;

export type ChunkRecoveryResult = 'not-chunk-error' | 'reloading' | 'reload-required' | 'already-reloaded';

interface ChunkRecoveryDependencies {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  reload?: () => void;
  fingerprint?: string;
  online?: boolean;
  schedule?: (callback: () => void) => void;
}

const getErrorText = (error: unknown) => {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const candidate = error as { name?: unknown; message?: unknown };
    return `${String(candidate.name || '')} ${String(candidate.message || '')}`;
  }
  return '';
};

export const isDynamicImportFailure = (error: unknown) => {
  const text = getErrorText(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed|ChunkLoadError/i.test(text);
};

export const getCurrentEntryFingerprint = () => {
  if (typeof document === 'undefined') return 'unknown-entry';
  const entry = Array.from(document.scripts)
    .map((script) => script.src)
    .find((src) => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(src));
  return entry ? new URL(entry, window.location.href).pathname : window.location.pathname;
};

export const hasRecentDynamicImportFailure = (now = Date.now()) =>
  latestDynamicImportFailureAt > 0 && now - latestDynamicImportFailureAt <= RECENT_CHUNK_FAILURE_WINDOW_MS;

export const recoverFromDynamicImportFailure = (
  error: unknown,
  dependencies: ChunkRecoveryDependencies = {},
): ChunkRecoveryResult => {
  if (!isDynamicImportFailure(error)) return 'not-chunk-error';
  const online = dependencies.online ?? (typeof navigator === 'undefined' ? true : navigator.onLine);
  if (!online) return 'not-chunk-error';
  latestDynamicImportFailureAt = Date.now();

  const storage = dependencies.storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
  const reload = dependencies.reload ?? (() => window.location.reload());
  const schedule = dependencies.schedule ?? ((callback) => window.setTimeout(callback, 0));
  const fingerprint = dependencies.fingerprint ?? getCurrentEntryFingerprint();
  const key = `${CHUNK_RECOVERY_PREFIX}${fingerprint}`;

  if (!storage) return 'reload-required';
  try {
    if (storage.getItem(key)) return 'already-reloaded';
    storage.setItem(key, new Date().toISOString());
  } catch {
    return 'reload-required';
  }

  schedule(reload);
  return 'reloading';
};
