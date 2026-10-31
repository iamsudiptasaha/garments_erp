# Account lifecycle and authenticator rollout

Implementation is local on `dev`. Nothing in this document authorizes production deployment or SQL execution.

**Confirmed flow:** email or ten-digit phone + password, followed by Google Authenticator for every enabled employee. Password recovery sends a single-use code only to the administrator inbox. This replaces the earlier password-only proposal. The standalone Gmail mailer is deployed and SMTP acceptance is verified; the account service and database rollout still require approval.

## Behaviour

- Administrators select an existing HR employee, enter their ten-digit Indian mobile number, select roles and create a login. Employee profiles remain under HR. Supabase Auth receives a random initial password which is never returned or displayed. New accounts require password setup. Creation across Auth and SQL uses compensation, not a claimed cross-service transaction; an unlinked Auth identity has no portal access.
- An administrator selects an enabled employee account and requests a password setup/recovery code. A cryptographically random, single-use credential is emailed **only** to `sahacreationsllp0int@gmail.com`. The employee contacts that administrator to obtain it. The employee enters their mobile number, code and new password in Forgot password.
- Existing passwords are never retrieved, emailed, logged or stored in business tables. The database stores only a peppered HMAC digest of a recovery code. Codes expire after 15 minutes, permit five attempts and cannot be reissued more than once a minute per account. A failed SMTP operation invalidates its reserved code. A failed password update after consumption requires a new code.
- Password reset invalidates existing sessions and preserves Google Authenticator enrollment. Lost-authenticator recovery is intentionally a separate administrative procedure; a password code cannot silently bypass MFA. Do not delete factors through an unaudited legacy endpoint.
- After password login, employees enroll Google Authenticator if needed, or verify their existing six-digit TOTP code. Business permissions require AAL2, a current unexpired database session, an enabled account and completed password setup. UI visibility alone is not enforcement.
- Signed-in users can change their password with current-password verification and MFA. They must sign in again afterwards. Existing signed file URLs remain valid for their short, 60-second TTL; revoking a session prevents new signed URLs.

## Proposed database changes

`supabase/migrations/20261031155332_account_lifecycle_mfa.sql` adds the password-setup flag, private recovery ledger, protected bootstrap security check, service-only recovery/reset commands and MFA/current-session checks to permission evaluation. Public wrappers invoke private helpers; administrative service credentials stay server-side. It has been exercised only in the dedicated local test project.

The earlier `20261029205748_harden_portal_database_boundary.sql` remains necessary to close direct-table bypasses. Review other application integrations before applying it. None of the pending account/boundary migrations has been applied to production by this work. The additional `20261031180430_require_active_authenticator_factor.sql` makes removal of the last verified TOTP factor immediately deny portal access, even with an old AAL2 token.

## Email configuration required

The standard SMTP adapter uses implicit TLS on port 465 with certificate verification. Server-only secrets required: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and a random `RECOVERY_PEPPER` of at least 32 characters. Supabase URL/keys are supplied by its function runtime. Do not put these secrets in Vite variables, Git, chat, or command output.

The standalone Gmail Worker now has its sender configured and a real SMTP acceptance test passed. The account backend still needs the private HTTP transport configuration (`MAILER_URL`, `MAILER_SHARED_SECRET`) and `RECOVERY_PEPPER`; see `gmail-worker-setup.md`. The generic SMTP fallback remains available. Do not use the normal mailbox password. The recipient is fixed server-side and cannot be changed by a recovery request.

## Deployment order — requires explicit approval

1. Resolve or retire the unreviewed legacy `admin-*` functions and review existing access integrations. They are not used by the new account service.
2. Keep public signup disabled. Confirm the phone provider allows existing confirmed accounts to use password login without SMS delivery. Do not enable an SMS service or SMS MFA as part of this change. Confirm TOTP enrollment and verification are enabled in production Auth before enforcing MFA. Existing administrators must be able to enroll during rollout; do not create a lockout by deploying half the change.
3. Review/apply the three database migrations through the approved production process. They have no automatic production runner.
4. Configure SMTP/pepper secrets and deploy `erp-accounts`. Its logged-out recovery action needs gateway JWT verification disabled for **this endpoint only**; the handler validates real Auth identity and current administrator/MFA permissions for every other operation. Recovery is authenticated by its bounded, single-use credential. Never disable JWT verification on unrelated endpoints as a workaround.
5. Deploy the coordinated frontend build, verify administrator enrollment and actual email delivery, then accept the release. The frontend fails closed if its required security RPC is absent.

The browser app contains no Cloudflare imports. Core lifecycle logic is in a plain JavaScript module with injected adapters; the existing Supabase backend adapter and standard SMTP transport can be replaced independently of frontend hosting.

## Verification

Local tests cover creation compensation, admin denial, failed email invalidation, recovery consumption order, password verification/revocation and credential validation. Isolated SQL checks cover AAL1 denial, AAL2 access, forced setup, invalid sessions, attempt limits, expiration, replay and two-session recovery consumption. Real local Auth and Storage checks exercise password login, TOTP enrollment/verification, private upload/finalisation/signed download, anonymous denial and revoked-session denial. The broader database suite covers file routes, bucket lifecycle, transactions, concurrency and synthetic backup restore.

The HTTP test also exercises the actual account handler, including creation, initial setup, failed SMTP invalidation, signed HTTP delivery through the mailer handler to a test-only mailbox, reset/replay denial and password changes. The test mailbox never sends a real email and exists only in the loopback harness. The local phone provider uses synthetic metadata and a database SMS hook that refuses all delivery; public signup is disabled. No real SMS provider is configured or contacted.

The standalone mailer test establishes SMTP acceptance, not end-to-end account recovery or the safety of unreviewed deployed legacy endpoints. Those remain explicit production acceptance items.
