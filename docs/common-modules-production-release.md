# Shared modules production release

Approved by the user in this chat, after review of `common-modules-production-rollout.md`.

## Deployed identity

- Application/backend source: `2cde2831a0cdeaefd0f76e592935d891d5aa8eee` on `dev`.
- Full release CI: https://github.com/iamsudiptasaha/garments_erp/actions/runs/41230345497 — all required jobs and release gate passed.
- Portal: https://garments-erp.sahacreationsllp0int.workers.dev/ — Worker version `11d6d2ea-bd28-4c26-913d-16a3e2c4ea3a`; hosted `release.json` matches the source commit.
- Mailer: `garments-erp-mailer`, version `895b408c-3599-4a20-9e00-32354661b3ab`. Real Gmail SMTP acceptance reverified using the fixed-recipient connection test.
- Supabase: project `kidvckaicclqvtlddeyz`; `erp-accounts` version 2 deployed. Logged-out recovery is supported; privileged operations still validate current Auth identity, MFA and administrator permission internally.

## Applied database changes

| Recorded migration | Change |
| --- | --- |
| `20261031182923_harden_portal_database_boundary` | Guarded portal-only ERP access |
| `20261031182944_account_lifecycle_mfa` | Private single-use recovery ledger, setup state, session/MFA enforcement |
| `20261031182953_require_active_authenticator_factor` | Reject stale AAL2 sessions without a verified TOTP factor |

The production migration recorder assigned these versions. Their reviewed SQL sources retain their original filenames in `supabase/migrations`.

## Final configuration and verification

- User chose **email/password + Google Authenticator** for now. Public signup is disabled. Phone authentication remains disabled; the UI reads the actual Auth provider setting and hides it. The previously approved mobile numbers are attached to the existing two administrator identities, without changing passwords or creating duplicate accounts.
- New employee login provisioning requires an email and the employee mobile number. It creates an administrator-controlled Auth identity; it is not public signup. This was verified against a disposable local Auth configuration with public signup and phone authentication both disabled.
- Recovery sends an eight-digit single-use OTP only to the fixed administrator inbox. It expires after 15 minutes, permits five attempts and revokes sessions when consumed. The requesting browser never receives the emailed OTP. The employee contacts the administrator for the code; Authenticator remains required after reset.
- Backend mailer authentication and recovery pepper are stored as server-only secrets. No Gmail credential or privileged key is part of the frontend.
- All seven legacy `admin-*` endpoints now return HTTP 410. Their gateway JWT verification remains enabled. Retirement responses were verified live; no account deletion operation was performed.
- Five ERP buckets remain private and nine upload routes retain their limits and mappings. Every table in `garments_erp` and `garments_access` has RLS enabled. Anonymous direct-table/bootstrap requests and unauthenticated recovery issuance were rejected in live checks.
- Local quality: 122 application tests; seven browser tests; backend type checks; dependency/secret/bundle guards; isolated SQL permissions, transactions, concurrency and restore checks; actual local Auth, TOTP, account handler, signed mail protocol and private Storage tests passed.
- Hosted read-only smoke: three passed, four fixture/login-writing tests intentionally inapplicable to production. HTTPS entry points, security headers and deployed commit were verified. A hosted-only assertion still expected the former phone field; it was corrected to email and the hosted tests rerun successfully. Application code did not change for that test correction.
- Existing business/account counts were preserved: two employee profiles, two linked application accounts and three total Auth identities. No production fixture account, attachment or storage object was created.

## Backup and rollback record

Before schema/account changes, schema, data and public RPC exports were created under the ignored, private local directory `.ci-runtime/production-backup-20261031/`, with owner-only access and a SHA-256 manifest. This directory contains sensitive database backup material: retain privately and never publish it. Managed backup listing had no available recent snapshot. A synthetic restore rehearsal passed; a restore of the real production export was not performed.

Portal version before rollout: `a62f529b-327e-4179-9aac-7568676a7d72`. Do not blindly roll back to its pre-MFA UI while the new database gate is active. Keep security restrictions closed and use coordinated roll-forward repair or an explicitly reviewed restore. Storage objects were not deleted or rewritten.

## Human acceptance remaining

Neither administrator had enrolled TOTP at the final check. Each must sign in with their existing email/password and enroll Google Authenticator. Keep the first working administrator session while setting up the second. Then verify a real administrator-issued recovery and an authenticated saved-record attachment round-trip. Isolated tests and SMTP acceptance do not substitute for those user-controlled production checks.

Other project schemas/buckets and their pre-existing advisor findings were outside this ERP rollout. This is not a claim that every application sharing the Supabase project has been security-audited.
