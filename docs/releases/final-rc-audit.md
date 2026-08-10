# Final RC audit

## Current release state

- Application runtime: v0.20.2
- Final governance gate: v0.20.3
- Production: closed test
- Public launch readiness: blocked only by external domain and mail delivery requirements

The inventory ledger, RLS and controlled RPC boundaries, backup/restore safeguards, account deletion, support diagnostics, production security headers, Android signing/App Links, stale-chunk recovery, tests, production build and dependency audit were verified in the preceding version records. Historical negative-stock and non-positive-activity rows remain intentionally untouched and visible through the data-health workflow.

## Repeatable release decision

Run `npm run check:public-launch`. A public release is allowed only when it exits `0`. The gate verifies:

- a non-hosting-default user-owned HTTPS domain;
- Supabase `mailer_autoconfirm=false` and non-sensitive Custom SMTP configuration state;
- recent real registration-confirmation and password-recovery mail evidence;
- public home, privacy, account-deletion and support endpoints with security headers;
- direct HTTPS `assetlinks.json` with the current Android package and release certificate.

The current closed-test run exits `1` with only `CUSTOM_DOMAIN` and `SMTP_EMAIL_FLOW`. This is the honest expected result until the user provides a domain and SMTP service and the two real mail flows are completed.

## Evidence index

- `.tools/evidence/public-launch-gate-report.json`: current non-sensitive gate report.
- `.tools/evidence/v0.20.2-release-record.json`: stale-chunk patch, production, Android hashes and test summary.
- `.tools/evidence/v0.20.2-stale-chunk-recovery-390x844.png`: no-PII mobile recovery evidence.
- `docs/public-launch-gate.md`: operator instructions and evidence schema.
- `docs/templates/public-launch-mail-evidence.example.json`: non-sensitive mail evidence template.

No real inventory, financial data or account deletion was performed for this governance release. The script never purchases a domain, sends test mail, or reads SMTP passwords.
