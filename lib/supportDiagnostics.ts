export type DiagnosticDomain = 'profile' | 'warehouses' | 'analytics' | 'recentActivities';
export type DiagnosticStatus = 'not_requested' | 'ok' | 'error';
export type ServiceHealthStatus = 'not_checked' | 'ok' | 'failed' | 'offline';

export interface DiagnosticDomainState {
  status: DiagnosticStatus;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  stale: boolean;
}

export interface DiagnosticErrorEvent {
  at: string;
  domain: DiagnosticDomain;
  code: 'request_failed';
}

export interface SupportDiagnosticState {
  domains: Record<DiagnosticDomain, DiagnosticDomainState>;
  recentErrors: DiagnosticErrorEvent[];
}

export interface ServiceHealthResult {
  status: ServiceHealthStatus;
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
}

export interface SupportDiagnosticReport {
  schemaVersion: 'support-diagnostic@1';
  diagnosticId: string;
  createdAt: string;
  app: {
    name: string;
    version: string;
  };
  platform: {
    runtime: 'web' | 'android' | 'ios';
  };
  network: {
    online: boolean;
  };
  services: {
    appAssets: ServiceHealthResult;
    identityService: ServiceHealthResult;
  };
  domains: Record<DiagnosticDomain, DiagnosticDomainState>;
  recentErrors: DiagnosticErrorEvent[];
}

const DOMAIN_NAMES: DiagnosticDomain[] = ['profile', 'warehouses', 'analytics', 'recentActivities'];
const MAX_ERROR_EVENTS = 12;

const emptyDomain = (): DiagnosticDomainState => ({ status: 'not_requested', stale: false });

export const createEmptySupportDiagnosticState = (): SupportDiagnosticState => ({
  domains: {
    profile: emptyDomain(),
    warehouses: emptyDomain(),
    analytics: emptyDomain(),
    recentActivities: emptyDomain(),
  },
  recentErrors: [],
});

const toIso = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('诊断时间无效');
  return date.toISOString();
};

export const recordDiagnosticDomainResult = (
  current: SupportDiagnosticState,
  domain: DiagnosticDomain,
  succeeded: boolean,
  at: Date | string = new Date(),
): SupportDiagnosticState => {
  const timestamp = toIso(at);
  const previous = current.domains[domain];
  const nextDomain: DiagnosticDomainState = succeeded
    ? {
        status: 'ok',
        lastSuccessAt: timestamp,
        lastFailureAt: previous.lastFailureAt,
        stale: false,
      }
    : {
        status: 'error',
        lastSuccessAt: previous.lastSuccessAt,
        lastFailureAt: timestamp,
        stale: Boolean(previous.lastSuccessAt),
      };

  return {
    domains: { ...current.domains, [domain]: nextDomain },
    recentErrors: succeeded
      ? current.recentErrors
      : [...current.recentErrors, { at: timestamp, domain, code: 'request_failed' as const }].slice(-MAX_ERROR_EVENTS),
  };
};

const createDiagnosticId = (): string => {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `DIAG-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};

const copyDomain = (value: DiagnosticDomainState): DiagnosticDomainState => ({
  status: value.status,
  ...(value.lastSuccessAt ? { lastSuccessAt: value.lastSuccessAt } : {}),
  ...(value.lastFailureAt ? { lastFailureAt: value.lastFailureAt } : {}),
  stale: Boolean(value.stale),
});

const copyHealth = (value: ServiceHealthResult): ServiceHealthResult => ({
  status: value.status,
  checkedAt: value.checkedAt,
  ...(Number.isFinite(value.latencyMs) ? { latencyMs: Math.max(0, Math.round(value.latencyMs!)) } : {}),
  ...(Number.isInteger(value.httpStatus) ? { httpStatus: value.httpStatus } : {}),
});

export const buildSupportDiagnosticReport = (input: {
  state: SupportDiagnosticState;
  appName: string;
  appVersion: string;
  runtime: 'web' | 'android' | 'ios';
  online: boolean;
  appAssets: ServiceHealthResult;
  identityService: ServiceHealthResult;
  now?: Date;
  diagnosticId?: string;
}): SupportDiagnosticReport => {
  const domains = Object.fromEntries(
    DOMAIN_NAMES.map((domain) => [domain, copyDomain(input.state.domains[domain])]),
  ) as Record<DiagnosticDomain, DiagnosticDomainState>;

  return {
    schemaVersion: 'support-diagnostic@1',
    diagnosticId: input.diagnosticId || createDiagnosticId(),
    createdAt: (input.now || new Date()).toISOString(),
    app: { name: input.appName, version: input.appVersion },
    platform: { runtime: input.runtime },
    network: { online: Boolean(input.online) },
    services: {
      appAssets: copyHealth(input.appAssets),
      identityService: copyHealth(input.identityService),
    },
    domains,
    recentErrors: input.state.recentErrors.slice(-MAX_ERROR_EVENTS).map((event) => ({
      at: event.at,
      domain: event.domain,
      code: 'request_failed',
    })),
  };
};

const probe = async (url: string, online: boolean, headers?: Record<string, string>): Promise<ServiceHealthResult> => {
  const checkedAt = new Date().toISOString();
  if (!online) return { status: 'offline', checkedAt };
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-store', credentials: 'omit', headers });
    return {
      status: response.ok ? 'ok' : 'failed',
      checkedAt,
      latencyMs: performance.now() - startedAt,
      httpStatus: response.status,
    };
  } catch {
    return { status: 'failed', checkedAt, latencyMs: performance.now() - startedAt };
  }
};

export const probeSupportServices = async (online = navigator.onLine) => {
  const base = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const publishableKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '');
  const [appAssets, identityService] = await Promise.all([
    probe(`${window.location.origin}/manifest.json`, online),
    base && publishableKey ? probe(`${base}/auth/v1/health`, online, { apikey: publishableKey }) : Promise.resolve<ServiceHealthResult>({
      status: 'failed',
      checkedAt: new Date().toISOString(),
    }),
  ]);
  return { appAssets, identityService };
};

export const buildPublicSupportIssueUrl = (baseUrl: string, appVersion: string, diagnosticId: string): string => {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/new`);
  url.searchParams.set('title', `[支持] ${diagnosticId}`);
  url.searchParams.set('body', `应用版本：${appVersion}\n诊断编号：${diagnosticId}\n\n请描述问题。请勿公开邮箱、订单号、库存明细、密码、令牌或未打码截图。`);
  return url.toString();
};
