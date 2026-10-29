# CI implementation and verification report

## Repository audit

The existing application is predominantly React **JavaScript**, with Vite and FortuneSheet, rather than a fully typed React/TypeScript application. The previous main-branch workflow deployed directly to Cloudflare Workers. Supabase migrations were incremental and did not contain a complete empty-database genesis. Direct access permissions outside the Fabric boundary needed hardening. These findings are addressed below without modifying production.

## Implemented locally

- Portable Overview landing page, simple permission-filtered analytics, separate Fabric overview and post-login redirect.
- Strict TypeScript configuration boundary; lint, formatting, unused/duplicate code checks, build, unit tests and Playwright.
- SHA-pinned Actions, exact npm dependencies/lockfiles, dependency audits, redacted history/source secret scans, CodeQL gate, frontend bundle/public-environment guards and hosting portability checks.
- PR release gate; manual staging-to-approved-production Pages workflow; serialized deployment, duplicate rejection, commit verification and approved asset rollback. Platform adapter dependencies are separate from the app.
- Isolated local Supabase schema baseline plus subsequent migrations, synthetic seeds, real concurrent database sessions and synthetic backup/restore test.
- Proposed database boundary migration: default-deny direct browser access, RLS and restricted helper execution, plus minimal successful Fabric save audit events. **Not applied to production.**
- Dependabot, scheduled scans, public health and repository-protection monitoring, CODEOWNERS and setup/recovery instructions.

## Verified on this machine

- 111 application tests; four security guard tests; six Chromium browser tests, including mocked login and swatch field locking.
- Quality/build checks, workflow syntax with actionlint 1.7.12, config/portability/bundle guards, and redacted secret scans.
- npm dependency audits reported zero vulnerabilities for frontend and deployment adapter at verification time.
- Isolated schema replay and database tests: anonymous/viewer denial, direct-access denial, valid write, bigint IDs, foreign-key failure, validated constraints, stale-write rejection, transactional rollback, audit events and real two-session locking. Synthetic database backup restored successfully.
- Local database lint returned no errors. Existing warnings include implicit text-to-JSONB initialization and stable functions calling volatile helpers; these remain review items.

## Requires configuration or further validation

- No workflow has run on GitHub yet; CodeQL, protected environments, branch protections, tokens, Pages projects, staging backend, hosted release verification and actual rollback remain unverified externally.
- The current live Worker is unchanged. No production deployment, infrastructure change or database migration was performed.
- TypeScript checks cover the new typed boundary and future TS files; legacy JavaScript has lint/tests but has **not** been fully migrated or typechecked.
- The database baseline is schema-only, captured from the existing database without business/Auth rows. Historical migrations before its cutoff are not replayed from genesis. Future migrations are replayed after that baseline.
- Browser tests use preview data and mocked authentication, with hosted tests limited to public smoke checks. Real authenticated staging HTTP/RLS integration and each Fabric document workflow still need acceptance testing with synthetic accounts.
- Protection checks inspect GitHub settings; database manifest matching is human attestation. Actual production database drift, backups/PITR, offsite retention, recovery objectives and recovery drills require operator setup.
- Scanners block known sensitive patterns but cannot prove arbitrary business data never leaks. No production data is included in CI fixtures or artifacts.

See [setup guide](secure-ci-setup.md). Production configuration and release require explicit approval.
