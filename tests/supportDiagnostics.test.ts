import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildPublicSupportIssueUrl,
  buildSupportDiagnosticReport,
  createEmptySupportDiagnosticState,
  recordDiagnosticDomainResult,
} from '../lib/supportDiagnostics.ts';

const health = { status: 'ok' as const, checkedAt: '2026-08-10T10:00:00.000Z', latencyMs: 12, httpStatus: 200 };

test('support diagnostics use a strict minimal whitelist and exclude supplied sensitive values', () => {
  const state = createEmptySupportDiagnosticState() as any;
  state.userId = '4dfe0cf4-6ab5-410f-a2ec-23687128e042';
  state.email = 'seller-private@example.com';
  state.product = 'Nike DD1391';
  state.warehouse = '惠来老家仓';
  state.token = 'TOKEN_REDACT_ME_PRIVATE_VALUE';
  state.domains.analytics = {
    status: 'error',
    stale: true,
    lastSuccessAt: '2026-08-10T09:00:00.000Z',
    lastFailureAt: '2026-08-10T10:00:00.000Z',
    rawError: 'order RC-123 seller-private@example.com',
  };

  const report = buildSupportDiagnosticReport({
    state,
    appName: '卖家库存助手',
    appVersion: '0.19.0',
    runtime: 'android',
    online: true,
    appAssets: health,
    identityService: health,
    now: new Date('2026-08-10T10:00:00.000Z'),
    diagnosticId: 'DIAG-00112233445566778899',
  });
  const serialized = JSON.stringify(report);

  for (const secret of ['4dfe0cf4-6ab5-410f-a2ec-23687128e042', 'seller-private@example.com', 'Nike DD1391', '惠来老家仓', 'TOKEN_REDACT_ME_PRIVATE_VALUE', 'RC-123']) {
    assert.equal(serialized.includes(secret), false, `diagnostic leaked ${secret}`);
  }
  assert.deepEqual(Object.keys(report).sort(), ['app', 'createdAt', 'diagnosticId', 'domains', 'network', 'platform', 'recentErrors', 'schemaVersion', 'services']);
  assert.match(report.diagnosticId, /^DIAG-[A-F0-9]{20}$/);
  assert.doesNotMatch(serialized, /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  assert.doesNotMatch(serialized, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test('diagnostic failures are bounded, stale only after a success, and reset cleanly', () => {
  let state = createEmptySupportDiagnosticState();
  state = recordDiagnosticDomainResult(state, 'warehouses', false, '2026-08-10T09:00:00Z');
  assert.equal(state.domains.warehouses.stale, false);
  state = recordDiagnosticDomainResult(state, 'warehouses', true, '2026-08-10T09:01:00Z');
  assert.equal(state.domains.warehouses.lastFailureAt, '2026-08-10T09:00:00.000Z');
  state = recordDiagnosticDomainResult(state, 'warehouses', false, '2026-08-10T09:02:00Z');
  assert.equal(state.domains.warehouses.stale, true);
  for (let index = 0; index < 20; index += 1) {
    state = recordDiagnosticDomainResult(state, 'analytics', false, new Date(Date.UTC(2026, 7, 10, 10, index)));
  }
  assert.equal(state.recentErrors.length, 12);
  assert.deepEqual(createEmptySupportDiagnosticState().recentErrors, []);
});

test('public issue URL carries only version and anonymous diagnostic id', () => {
  const url = buildPublicSupportIssueUrl('https://github.com/Hendrik-Hu/dewu-seller-pro/issues', '0.19.0', 'DIAG-00112233445566778899');
  assert.equal(url.includes('seller-private'), false);
  assert.match(decodeURIComponent(url), /0\.19\.0/);
  assert.match(decodeURIComponent(url), /DIAG-00112233445566778899/);
});

test('support entry is gated in app and public templates warn against private data', () => {
  const profile = readFileSync(new URL('../components/Profile.tsx', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../components/SupportDiagnosticsModal.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const issueTemplate = readFileSync(new URL('../.github/ISSUE_TEMPLATE/support.yml', import.meta.url), 'utf8');
  const security = readFileSync(new URL('../SECURITY.md', import.meta.url), 'utf8');

  assert.doesNotMatch(profile, /openExternalUrl\(PUBLIC_LINKS\.support\)/);
  assert.match(profile, /setShowSupportModal\(true\)/);
  assert.match(modal, /checked=\{confirmed\}/);
  assert.match(modal, /disabled=\{!confirmed \|\| !online\}/);
  assert.match(modal, /bg-slate-100/);
  assert.match(modal, /import\.meta\.env\.DEV.*diagnostic-preview/);
  assert.match(modal, /不要上传密码、令牌、邮箱、订单号、库存明细/);
  assert.match(app, /setSupportDiagnosticState\(createEmptySupportDiagnosticState\(\)\)/);
  assert.match(issueTemplate, /请勿提交密码、令牌、邮箱、订单号、库存明细/);
  assert.match(security, /Security Advisory/);
});
