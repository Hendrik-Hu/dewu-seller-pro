import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAIL_EVIDENCE_SCHEMA,
  evaluateAssetLinks,
  evaluateAuthMailConfig,
  evaluateMailEvidence,
  isUserOwnedProductionOrigin,
  runPublicLaunchGate,
} from '../scripts/public-launch-gate.mjs';

const now = new Date('2026-08-10T12:00:00.000Z');
const siteOrigin = 'https://inventory.example.com';
const projectRef = 'project-ref';
const packageName = 'com.hendrikhu.sellerinventory';
const certificateFingerprint = '4B0793707C76CCCA3F4A5A2D84911E3B36A9C833AAC41F472441902E10B8A885';
const headers = {
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(self)',
  'strict-transport-security': 'max-age=31536000',
};
const mailEvidence = {
  schemaVersion: MAIL_EVIDENCE_SCHEMA,
  testedAt: '2026-08-10T11:45:00.000Z',
  siteOrigin,
  projectRef,
  registrationConfirmation: { status: 'passed', completedAt: '2026-08-10T11:40:00.000Z', evidenceRef: 'release-record:signup-confirm' },
  passwordRecovery: { status: 'passed', completedAt: '2026-08-10T11:42:00.000Z', evidenceRef: 'release-record:password-recovery' },
};
const authConfig = {
  mailer_autoconfirm: false,
  smtp_host: 'smtp.example.com',
  smtp_port: 587,
  smtp_user: 'configured-user',
  smtp_admin_email: 'configured-sender',
};

const fakeFetch = async (input: string | URL) => {
  const url = String(input);
  if (url.endsWith('/.well-known/assetlinks.json')) {
    return new Response(JSON.stringify([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: [certificateFingerprint],
      },
    }]), { status: 200, headers: { ...headers, 'content-type': 'application/json' } });
  }
  return new Response('ok', { status: 200, headers });
};

test('public launch requires a user-owned HTTPS origin instead of hosting defaults', () => {
  assert.equal(isUserOwnedProductionOrigin('https://inventory.example.com'), true);
  assert.equal(isUserOwnedProductionOrigin('https://project.vercel.app'), false);
  assert.equal(isUserOwnedProductionOrigin('http://inventory.example.com'), false);
  assert.equal(isUserOwnedProductionOrigin('https://127.0.0.1'), false);
});

test('auth readiness checks only non-secret SMTP fields and disables autoconfirm', () => {
  assert.deepEqual(evaluateAuthMailConfig(authConfig), {
    passed: true,
    autoconfirmDisabled: true,
    customSmtpConfigured: true,
    reasons: [],
  });
  assert.equal(evaluateAuthMailConfig({ ...authConfig, mailer_autoconfirm: true }).passed, false);
  assert.equal(evaluateAuthMailConfig({ ...authConfig, smtp_host: '' }).passed, false);
  const source = readFileSync(new URL('../scripts/public-launch-gate.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /smtp_pass/i);
});

test('mail evidence must cover recent real registration and recovery flows', () => {
  assert.equal(evaluateMailEvidence({ evidence: mailEvidence, now, siteOrigin, projectRef }).passed, true);
  assert.equal(evaluateMailEvidence({ evidence: { ...mailEvidence, testedAt: '2026-06-01T00:00:00.000Z' }, now, siteOrigin, projectRef }).passed, false);
  assert.equal(evaluateMailEvidence({ evidence: { ...mailEvidence, passwordRecovery: undefined }, now, siteOrigin, projectRef }).passed, false);
});

test('assetlinks binds the current package and release certificate fingerprint', () => {
  const document = [{ target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: [certificateFingerprint.match(/.{2}/g)?.join(':')] } }];
  assert.equal(evaluateAssetLinks({ document, packageName, certificateFingerprint }).passed, true);
  assert.equal(evaluateAssetLinks({ document, packageName: 'invalid.package', certificateFingerprint }).passed, false);
});

test('a complete public release gate passes all routes, headers, mail and app-link checks', async () => {
  const report = await runPublicLaunchGate({
    siteUrl: siteOrigin,
    supportUrl: 'https://support.example.com',
    projectRef,
    authConfig,
    mailEvidence,
    packageName,
    certificateFingerprint,
    fetchImpl: fakeFetch as typeof fetch,
    now,
  });
  assert.equal(report.ready, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.checks.routes.length, 4);
});

test('the current closed-test shape reports only custom-domain and SMTP-chain blockers', async () => {
  const report = await runPublicLaunchGate({
    siteUrl: 'https://project.vercel.app',
    supportUrl: 'https://support.example.com',
    projectRef,
    authConfig: undefined,
    mailEvidence: undefined,
    packageName,
    certificateFingerprint,
    fetchImpl: fakeFetch as typeof fetch,
    now,
  });
  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.code), ['CUSTOM_DOMAIN', 'SMTP_EMAIL_FLOW']);
});

test('the report never carries supplied credentials, email addresses or mail contents', async () => {
  const secret = 'secret-value-that-must-not-appear';
  const privateEmail = 'private@example.com';
  const passwordField = ['smtp', 'pass'].join('_');
  const accessTokenField = ['access', 'token'].join('_');
  const report = await runPublicLaunchGate({
    siteUrl: siteOrigin,
    supportUrl: 'https://support.example.com',
    projectRef,
    authConfig: { ...authConfig, [passwordField]: secret, [accessTokenField]: secret },
    mailEvidence: {
      ...mailEvidence,
      testEmail: privateEmail,
      registrationConfirmation: { ...mailEvidence.registrationConfirmation, rawMail: secret },
    },
    packageName,
    certificateFingerprint,
    fetchImpl: fakeFetch as typeof fetch,
    now,
  });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(privateEmail));
  assert.equal(serialized.includes(passwordField), false);
  assert.equal(serialized.includes(accessTokenField), false);
  assert.doesNotMatch(serialized, /rawMail/);
});

test('a public path missing a required security header blocks release', async () => {
  const incompleteFetch = async (input: string | URL) => {
    const response = await fakeFetch(input);
    if (String(input).endsWith('/privacy.html')) {
      const incomplete = { ...headers } as Record<string, string>;
      delete incomplete['content-security-policy'];
      return new Response('privacy', { status: 200, headers: incomplete });
    }
    return response;
  };
  const report = await runPublicLaunchGate({
    siteUrl: siteOrigin,
    supportUrl: 'https://support.example.com',
    projectRef,
    authConfig,
    mailEvidence,
    packageName,
    certificateFingerprint,
    fetchImpl: incompleteFetch as typeof fetch,
    now,
  });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((item) => item.code === 'PUBLIC_ROUTE_PRIVACY'));
});

test('the repeatable command and operator documentation remain wired into the repository', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const docs = readFileSync(new URL('../docs/public-launch-gate.md', import.meta.url), 'utf8');
  assert.equal(packageJson.scripts['check:public-launch'], 'node scripts/public-launch-gate.mjs');
  assert.match(readme, /npm run check:public-launch/);
  assert.match(docs, /SUPABASE_ACCESS_TOKEN/);
  assert.match(docs, /不得写入.*日志.*截图.*Git/);
});
