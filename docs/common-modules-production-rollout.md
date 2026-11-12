# Shared modules release candidate

For applied changes and current production status, see [production release record](common-modules-production-release.md).

Prepared on 31 October 2026 on `dev`. Production changes require approval. This document is not a production sign-off.

## Confirmed behaviour

- Current approved login is email + password, then Google Authenticator. Phone authentication remains disabled by the user’s explicit choice; public signup is disabled. The UI reads public Auth provider settings and only offers phone login when that provider is enabled. New employee provisioning requires an email as well as the recorded mobile number. Email sign-in is available to all linked accounts, not only administrators. There is no separate custom username registry.
- First login offers authenticator enrollment. Business data, file operations and Administration remain inaccessible until a current enabled account has verified MFA. An old AAL2 token no longer grants access after the last verified TOTP factor is removed.
- An MFA-verified administrator selects an employee and sends a single-use password setup/recovery code to `sahacreationsllp0int@gmail.com`. The employee obtains it from the administrator, enters it with their phone number and chooses a new password. The response never contains the code. Reset preserves the authenticator and revokes existing sessions. Lost-authenticator recovery is not a password reset.
- New recovery codes are eight-digit numeric OTPs (legacy 32-character credentials remain accepted during rollout), expire in 15 minutes, allow five attempts and are usable once. They are not six-digit authenticator codes. Only digests are stored in the database. Administrator-only issuance avoids a public email-spamming endpoint.
- Employee records remain in HR. Administration creates/links logins, assigns roles, enables/disables accounts, archives unassigned roles and reviews activity. Last-administrator and stale-update protections remain enforced server-side.
- Five registered ERP buckets are private. Nine attachment routes specify destination, allowed MIME types and maximum size. Their current limit is 10 MiB. Image-only routes are `itemImage` and `labDipShade`. Existing attachments keep their original location when a route changes. Bucket removal remains limited to unused empty buckets.

## Verified in this preparation

- Fresh isolated database schema replay and contracts: direct-access denial, permissions, MFA gates, stale writes, transactions, concurrency, recovery limits/replay/session revocation, bucket lifecycle, attachment routes, and synthetic backup restore.
- Real local Auth password/TOTP enrollment/verification plus private Storage upload, atomic attachment finalisation, signed read, anonymous denial and revoked-session denial.
- Actual account HTTP handler through the signed mail protocol and mailer handler to an in-memory SMTP substitute, followed by actual password reset and replay denial. The harness is bound to loopback, accepts only the local test project and cannot contact external mail services.
- Application quality checks and backend type checking. Browser tests include email/password stopping at the Authenticator screen without requesting business data.
- Live read-only checks: five ERP buckets private; all nine registered routes present; two enabled administrators and zero enrolled verified TOTP factors. Both existing administrators have confirmed emails but no Auth phone set; attach the previously supplied numbers to their existing identities through the Auth Admin API during approved rollout, without creating new identities or sending SMS. The mailer previously passed a real Gmail SMTP acceptance test.

## Exact production changes proposed

Apply these pending migrations in order, after backup and compatibility review:

1. `supabase/migrations/20261031182923_harden_portal_database_boundary.sql`: close direct table/view/function access outside guarded portal commands. This changes access for other applications editing the same tables; it does not remove business records.
2. `supabase/migrations/20261031182944_account_lifecycle_mfa.sql`: password-setup flag, private recovery ledger and service-only commands, current-session/MFA permission enforcement, and safe login bootstrap.
3. `supabase/migrations/20261031182953_require_active_authenticator_factor.sql`: deny stale MFA access when no verified authenticator remains.

Deploy the backward-compatible mailer protocol update first (it accepts numeric OTPs as well as legacy credentials). Replace the seven retired legacy endpoints described below. Configure server-only `MAILER_URL`, `MAILER_SHARED_SECRET` and `RECOVERY_PEPPER`, then deploy the reviewed `erp-accounts` function. The mailer key must match the existing Worker; never place these values in Vite settings or Git. Keep the Gmail app password only in the mailer Worker. Disabling gateway JWT verification is required only for this function's logged-out recovery operation: its authenticated operations independently validate the Auth user and administrator/MFA permissions.

Deploy the coordinated frontend only after the database and backend are ready. Verify TOTP enrollment and challenge APIs are enabled and public signup is disabled. Use a maintenance window because the old and new account frontends depend on different security bootstrap behaviour. Do not activate the pending migration alone and assume the existing frontend supports it.

No bucket recreation, public bucket conversion, object deletion, phone SMS delivery or paid infrastructure is proposed. Non-ERP buckets in this shared project are outside this release.

## Outstanding acceptance requirements

1. The user confirmed the seven legacy endpoints are unused and requested preparation of their retirement. Reviewed replacements in `supabase/functions/admin-*/index.ts` return HTTP 410 with no Auth, database or credential access. Deploy these replacements with gateway JWT verification retained. Endpoints: `admin-create-user`, `admin-delete-user`, `admin-generate-link`, `admin-get-user`, `admin-invite-user`, `admin-list-users`, `admin-update-user`. This closes the unknown legacy behaviour without deleting any account.
2. The user confirmed portal-only ERP writes. Direct-table restrictions are therefore in the agreed release scope. Other schemas and unrelated public buckets remain outside this rollout.
3. Confirm a current production backup and the restore procedure. The passing synthetic restore rehearsal is not a production backup.
4. Supabase CLI authorization is required to configure server-side secrets; the connected database tools do not expose secret management. Run `npx --yes supabase@2.122.0 login` locally and complete the browser flow without sharing tokens. Obtain final approval for the exact migrations, function/configuration changes and frontend deployment above. No production database, Auth configuration, account or portal deployment was changed during this preparation.
5. During the approved rollout, enroll and verify the first administrator, then verify the second administrator. Keep the first working MFA session until both succeed. Test normal staff denial of Administration, an approved recovery email, a private test attachment round-trip and disabled-account denial before ending maintenance.

If rollout fails, keep the permission boundary closed and use maintenance/roll-forward repair. Do not remove MFA, grant broad table privileges, recreate buckets or restore/delete production data automatically to make smoke tests pass. Retain reviewed previous artifacts and migration checksums with the release record.

## Release gate corrections

The live registry advisory GHSA-g3hv-75wg-m249 required minimatch 11.0.1 in the lint toolchain. The exact override and lockfile patch passed the original audit threshold and full quality checks. GitHub CodeQL analysis and SARIF validation passed, but upload to the disabled repository Security dashboard failed. CI now retains the validated SARIF as a private artifact; scanning and failure enforcement are unchanged. No paid feature was enabled. The existing portal remains on Cloudflare Workers; `deploy/cloudflare/workers.json` is a hosting-only static asset adapter alongside the future Pages adapter.
