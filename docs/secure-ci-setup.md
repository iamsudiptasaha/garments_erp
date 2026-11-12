# Secure release setup

The application is a portable static Vite build in `fabric-poc/dist`. Supabase remains its existing backend. Cloudflare tooling is isolated in `deploy/cloudflare`; changing hosts does not require changing application code. No Cloudflare runtime, database, queue or storage binding is used. Additional platform services require the owner's explicit approval.

## Before enabling releases

These are operator configuration steps, not changes performed by this patch. Obtain approval before changing production infrastructure or applying production SQL.

1. Create a Cloudflare **Pages** project with production branch `main`, without native Git auto-builds. The existing Workers deployment remains untouched. Agree the Pages cutover before changing production URLs. Use a separate staging Supabase project containing synthetic data.
2. Protect `main`: pull requests, at least one independent approval, code-owner review, dismissal of stale reviews, up-to-date required **Release gate** check, and enforcement for administrators. Restrict push access. Do not allow bypasses.
3. Create GitHub environments `staging` and `production`. Production must require an independent reviewer, prevent self-review, disallow administrator bypass, and accept protected branches only. Restrict other protected branches so only `main` can release. Verify bypass settings manually where the API does not expose them. A sole repository owner cannot independently approve their own deployment.
4. Add environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Use account-scoped **Pages Edit** tokens, not global API keys or the earlier Workers token. Pages token access is account-scoped: separate Cloudflare accounts provide stronger staging/production isolation than project names alone. Do not put tokens in source, public variables or build commands.
5. Add environment variables `CLOUDFLARE_PAGES_PROJECT`, `DEPLOYMENT_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY`. Publishable keys are intentionally public; never use service-role/secret keys. Staging also needs `PRODUCTION_SUPABASE_URL` for the backend separation check. Configure Supabase Auth redirect/site URLs for the approved host.
6. Supply a narrowly scoped, read-only `GH_POLICY_TOKEN` for repository Administration/settings and Actions if the workflow token cannot read protections. The scheduled monitor uses a repository secret of the same name and repository variable `PRODUCTION_DEPLOYMENT_URL`. Enable Actions failure notifications.
7. Have the database owner review the proposed hardening migration, existing access integrations and backup/recovery plan. Apply production migrations only through a separately approved process. Set production environment variable `APPLIED_DATABASE_MANIFEST_SHA256` to the output of `node scripts/ci/check-db-approval.mjs --print` only after confirming the reviewed SQL is applied. This is an explicit human attestation, not a live database drift check.
8. Enable CodeQL/code scanning for this repository. Private repositories may require a GitHub plan/license that supports it; do not remove the gate if unavailable. Review the licensing/configuration first.

## Normal flow

PRs run quality, browser, dependency, secret, CodeQL and isolated database checks. The **Release gate** fails if any constituent job fails. Dependabot opens weekly update PRs; it does not auto-merge them.

After merging a reviewed commit to `main`, manually run **Approved Pages release**. It reruns checks, builds/deploys staging, verifies the deployed commit and public browser smoke tests, then waits for production environment approval. Production rechecks protection and the database attestation, builds using production public configuration, deploys and verifies its commit marker. Staging and production use the same commit, but environment-specific bundles. Release concurrency serializes runs; duplicate production commits are rejected. Do not enable a second automatic deployment system.

## Local verification

Use the pinned Node version in `.nvmrc` and `npm --prefix fabric-poc ci`. Run `npm --prefix fabric-poc run quality`, `node --test scripts/ci/security.test.mjs`, and browser tests against a build made with the synthetic public settings used in CI. The mocked sign-in test must never target a real backend. The normal local build can then restore your local public configuration.

Database checks require Docker and Supabase CLI 2.122.0. Run `bash scripts/ci/prepare-database-project.sh` to copy the canonical Auth templates into the disposable project. Start only the dedicated project with `npx supabase@2.122.0 db start --workdir database/ci/project`, then run `bash scripts/ci/test-database.sh` against its fresh database. The script refuses remote databases and production credential variables. It is destructive to this dedicated test database only; use a fresh instance for reruns. CI stops it after testing.

## Recovery and operations

Use **Approved Pages rollback** with a previously successful production deployment ID and independent approval. It rolls back application assets only and performs a health check. Do not roll back schema automatically; use forward fixes or a separately approved database recovery plan. Keep migrations backward-compatible with the previous release.

The six-hour monitor checks the public site and repository protection drift. GitHub Actions history, minimal build provenance, Cloudflare deployment history and database save audit events provide evidence. Configure alert recipients and retention. Never add raw request bodies, customer records, passwords or tokens to logs/artifacts.

Before production: document RPO/RTO, verify the actual Supabase backup/PITR entitlement, arrange encrypted offsite backups where needed, and perform a controlled recovery drill. The synthetic CI backup restore is not evidence that a production backup exists or is recoverable. Live database drift monitoring requires a separately configured read-only audit connection; none is distributed to PR tests.
