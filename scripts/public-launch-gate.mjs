import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAIL_EVIDENCE_SCHEMA = 'seller-inventory/public-launch-mail-evidence@1';
export const DEFAULT_MAX_EVIDENCE_AGE_DAYS = 30;

const REQUIRED_APP_HEADERS = [
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'strict-transport-security',
];
const REQUIRED_SUPPORT_HEADERS = [
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
];

const cleanFingerprint = (value) => String(value || '').replace(/[^a-f0-9]/gi, '').toUpperCase();
const cleanOrigin = (value) => {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('必须使用不含凭据、查询参数或锚点的 HTTPS 地址');
  }
  return url.origin;
};

export const isUserOwnedProductionOrigin = (value) => {
  try {
    const url = new URL(cleanOrigin(value));
    const host = url.hostname.toLowerCase();
    return !(
      host === 'localhost'
      || host.endsWith('.localhost')
      || host.endsWith('.vercel.app')
      || host.endsWith('.netlify.app')
      || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
      || host === '::1'
    );
  } catch {
    return false;
  }
};

const parseTimestamp = (value) => {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : undefined;
};

export const evaluateMailEvidence = ({ evidence, now = new Date(), siteOrigin, projectRef, maxAgeDays = DEFAULT_MAX_EVIDENCE_AGE_DAYS }) => {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { passed: false, reasons: ['缺少邮件整链验收凭证'] };
  }
  const reasons = [];
  if (evidence.schemaVersion !== MAIL_EVIDENCE_SCHEMA) reasons.push('邮件凭证 schemaVersion 不受支持');
  if (evidence.siteOrigin !== siteOrigin) reasons.push('邮件凭证与当前公开域名不一致');
  if (evidence.projectRef !== projectRef) reasons.push('邮件凭证与当前 Supabase 项目不一致');

  const testedAt = parseTimestamp(evidence.testedAt);
  const ageMs = testedAt === undefined ? Number.POSITIVE_INFINITY : now.getTime() - testedAt;
  if (testedAt === undefined || ageMs < 0 || ageMs > maxAgeDays * 86_400_000) {
    reasons.push(`邮件整链验收不是最近 ${maxAgeDays} 天内完成`);
  }

  const requireFlow = (key, label) => {
    const flow = evidence[key];
    const completedAt = parseTimestamp(flow?.completedAt);
    const evidenceRef = typeof flow?.evidenceRef === 'string' ? flow.evidenceRef.trim() : '';
    if (flow?.status !== 'passed' || completedAt === undefined) {
      reasons.push(`${label}尚无成功验收记录`);
      return;
    }
    if (completedAt > now.getTime() || now.getTime() - completedAt > maxAgeDays * 86_400_000) reasons.push(`${label}验收时间无效`);
    if (!/^[A-Za-z0-9._:/-]{8,120}$/.test(evidenceRef)) reasons.push(`${label}缺少非敏感证据引用`);
  };
  requireFlow('registrationConfirmation', '真实注册确认邮件');
  requireFlow('passwordRecovery', '忘记密码邮件');

  return { passed: reasons.length === 0, reasons, testedAt: testedAt === undefined ? null : new Date(testedAt).toISOString() };
};

export const evaluateAuthMailConfig = (config) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { passed: false, autoconfirmDisabled: false, customSmtpConfigured: false, reasons: ['无法核验 Supabase Auth 非敏感配置状态'] };
  }
  const autoconfirmDisabled = config.mailer_autoconfirm === false;
  const smtpHost = typeof config.smtp_host === 'string' ? config.smtp_host.trim() : '';
  const smtpPort = Number(config.smtp_port);
  const smtpUserPresent = typeof config.smtp_user === 'string' && config.smtp_user.trim().length > 0;
  const smtpAdminPresent = typeof config.smtp_admin_email === 'string' && config.smtp_admin_email.trim().length > 0;
  const customSmtpConfigured = Boolean(
    smtpHost
    && !/(^|\.)supabase\.(?:com|co)$/i.test(smtpHost)
    && Number.isInteger(smtpPort)
    && smtpPort > 0
    && smtpUserPresent
    && smtpAdminPresent
  );
  const reasons = [];
  if (!autoconfirmDisabled) reasons.push('Auth 仍启用注册自动确认');
  if (!customSmtpConfigured) reasons.push('Custom SMTP 非敏感配置项未完整配置');
  return { passed: reasons.length === 0, autoconfirmDisabled, customSmtpConfigured, reasons };
};

const inspectResponse = async (response, requiredHeaders) => {
  const missingHeaders = requiredHeaders.filter((name) => !response.headers.get(name));
  return {
    passed: response.status === 200 && missingHeaders.length === 0,
    status: response.status,
    missingHeaders,
  };
};

const fetchWithTimeout = async (fetchImpl, url, timeoutMs = 15_000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

export const evaluateAssetLinks = ({ document, packageName, certificateFingerprint }) => {
  const expectedFingerprint = cleanFingerprint(certificateFingerprint);
  const rows = Array.isArray(document) ? document : [];
  const matched = rows.some((row) => row?.target?.namespace === 'android_app'
    && row.target.package_name === packageName
    && Array.isArray(row.target.sha256_cert_fingerprints)
    && row.target.sha256_cert_fingerprints.some((value) => cleanFingerprint(value) === expectedFingerprint));
  return { passed: Boolean(packageName && expectedFingerprint.length === 64 && matched), packageName, certificateMatched: matched };
};

export const runPublicLaunchGate = async ({
  siteUrl,
  supportUrl,
  projectRef,
  authConfig,
  mailEvidence,
  packageName,
  certificateFingerprint,
  fetchImpl = fetch,
  now = new Date(),
}) => {
  let siteOrigin = '';
  try { siteOrigin = cleanOrigin(siteUrl); } catch { siteOrigin = String(siteUrl || ''); }
  const blockers = [];
  const customDomainPassed = isUserOwnedProductionOrigin(siteUrl);
  if (!customDomainPassed) {
    blockers.push({ code: 'CUSTOM_DOMAIN', message: '缺少用户自有 HTTPS 域名（vercel.app 等托管默认域名不算正式域名）' });
  }

  const auth = evaluateAuthMailConfig(authConfig);
  const mailEvidenceResult = evaluateMailEvidence({ evidence: mailEvidence, now, siteOrigin, projectRef });
  if (!auth.passed || !mailEvidenceResult.passed) {
    blockers.push({
      code: 'SMTP_EMAIL_FLOW',
      message: 'Custom SMTP 与真实邮件整链尚未达到公开发布要求',
      details: [...auth.reasons, ...mailEvidenceResult.reasons],
    });
  }

  const routeSpecs = [
    { key: 'home', url: `${siteOrigin}/`, headers: REQUIRED_APP_HEADERS },
    { key: 'privacy', url: `${siteOrigin}/privacy.html`, headers: REQUIRED_APP_HEADERS },
    { key: 'accountDeletion', url: `${siteOrigin}/account-deletion.html`, headers: REQUIRED_APP_HEADERS },
    { key: 'support', url: supportUrl, headers: REQUIRED_SUPPORT_HEADERS },
  ];
  const routes = [];
  for (const spec of routeSpecs) {
    try {
      const response = await fetchWithTimeout(fetchImpl, spec.url);
      const result = await inspectResponse(response, spec.headers);
      routes.push({ key: spec.key, ...result });
      if (!result.passed) blockers.push({ code: `PUBLIC_ROUTE_${spec.key.toUpperCase()}`, message: `公开入口 ${spec.key} 未返回 200 或缺少安全响应头`, details: result.missingHeaders });
    } catch {
      routes.push({ key: spec.key, passed: false, status: null, missingHeaders: [] });
      blockers.push({ code: `PUBLIC_ROUTE_${spec.key.toUpperCase()}`, message: `公开入口 ${spec.key} 无法访问` });
    }
  }

  let assetLinks = { passed: false, packageName, certificateMatched: false };
  try {
    const response = await fetchWithTimeout(fetchImpl, `${siteOrigin}/.well-known/assetlinks.json`);
    const responseCheck = await inspectResponse(response, ['content-type', 'strict-transport-security']);
    const contentType = response.headers.get('content-type') || '';
    const document = response.status === 200 && /application\/json/i.test(contentType) ? await response.json() : undefined;
    assetLinks = {
      ...evaluateAssetLinks({ document, packageName, certificateFingerprint }),
      status: response.status,
      directHttps: response.status === 200,
      contentTypeJson: /application\/json/i.test(contentType),
      securityHeadersPassed: responseCheck.missingHeaders.length === 0,
    };
  } catch {
    assetLinks = { ...assetLinks, status: null, directHttps: false, contentTypeJson: false, securityHeadersPassed: false };
  }
  if (!assetLinks.passed || !assetLinks.directHttps || !assetLinks.contentTypeJson || !assetLinks.securityHeadersPassed) {
    blockers.push({ code: 'ANDROID_APP_LINK', message: 'assetlinks 与当前 Android 包名或发布证书不一致，或入口不是安全的 JSON 直达响应' });
  }

  return {
    schemaVersion: 'seller-inventory/public-launch-gate-report@1',
    checkedAt: now.toISOString(),
    ready: blockers.length === 0,
    checks: {
      customDomain: { passed: customDomainPassed, host: (() => { try { return new URL(siteOrigin).hostname; } catch { return ''; } })() },
      auth: { configVerified: Boolean(authConfig), autoconfirmDisabled: auth.autoconfirmDisabled, customSmtpConfigured: auth.customSmtpConfigured },
      mailEvidence: { passed: mailEvidenceResult.passed, testedAt: mailEvidenceResult.testedAt || null },
      routes,
      assetLinks,
    },
    blockers,
  };
};

const readOptionalJson = async (filePath) => {
  if (!filePath) return undefined;
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch { return undefined; }
};

const readSimpleEnv = async (filePath) => {
  try {
    const text = await readFile(filePath, 'utf8');
    return Object.fromEntries(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && line.includes('=')).map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
  } catch {
    return {};
  }
};

const parseProjectRef = (supabaseUrl) => {
  try { return new URL(supabaseUrl).hostname.split('.')[0]; } catch { return ''; }
};

const fetchAuthConfig = async ({ accessToken, projectRef, fetchImpl = fetch }) => {
  if (!accessToken || !projectRef) return undefined;
  try {
    const response = await fetchImpl(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/config/auth`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
};

const main = async () => {
  const fileEnv = await readSimpleEnv(path.resolve('.env.local'));
  const env = { ...fileEnv, ...process.env };
  const siteUrl = env.PUBLIC_LAUNCH_SITE_URL || env.VITE_PUBLIC_SITE_URL || '';
  const supportUrl = env.PUBLIC_LAUNCH_SUPPORT_URL || 'https://github.com/Hendrik-Hu/dewu-seller-pro/issues';
  const projectRef = env.SUPABASE_PROJECT_REF || parseProjectRef(env.VITE_SUPABASE_URL);
  const evidencePath = path.resolve(env.PUBLIC_LAUNCH_MAIL_EVIDENCE || '.tools/evidence/public-launch-mail-evidence.json');
  const reportPath = path.resolve(env.PUBLIC_LAUNCH_REPORT || '.tools/evidence/public-launch-gate-report.json');
  const [authConfig, mailEvidence, certificateFingerprint, buildGradle] = await Promise.all([
    fetchAuthConfig({ accessToken: process.env.SUPABASE_ACCESS_TOKEN, projectRef }),
    readOptionalJson(evidencePath),
    readFile(path.resolve('android/release-certificate.sha256'), 'utf8').catch(() => ''),
    readFile(path.resolve('android/app/build.gradle'), 'utf8').catch(() => ''),
  ]);
  const packageName = buildGradle.match(/applicationId\s+["']([^"']+)["']/)?.[1] || '';
  const report = await runPublicLaunchGate({ siteUrl, supportUrl, projectRef, authConfig, mailEvidence, packageName, certificateFingerprint });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (report.ready) {
    console.log('公开发布闸门：通过。');
    console.log(`非敏感报告：${reportPath}`);
    return;
  }
  console.error(`公开发布闸门：未通过（${report.blockers.length} 项阻断）`);
  for (const blocker of report.blockers) {
    console.error(`- ${blocker.message}`);
    for (const detail of blocker.details || []) console.error(`  · ${detail}`);
  }
  console.error(`非敏感报告：${reportPath}`);
  process.exitCode = 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
