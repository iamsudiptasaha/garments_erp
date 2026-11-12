# CI and production release

[ERP CI](../.github/workflows/verify.yml) runs on pull requests and pushes to `dev` and `main`. It checks lint, types, builds, unit and Chromium tests, dependencies and secrets, and SQL and authenticated HTTP integration against disposable Supabase. Keep **Release gate** required on protected `main`. Only a successful push to `main` can deploy.

## One-time GitHub configuration

Use the existing `production` GitHub Actions environment. Under **Deployment branches and tags**, select **Selected branches and tags** and add `main` as the only allowed branch. This scopes production credentials to `main` even if a workflow is edited on `dev`.

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `PRODUCTION_DATABASE_URL` | Production Supabase direct or session pooler Postgres URL on port 5432. Use the production project username and percent-encode the password. The runner enforces certificate verification. |
| Secret | `SUPABASE_ACCESS_TOKEN` | Supabase deployment identity with permission to deploy Edge Functions to the production project. |
| Secret | `CLOUDFLARE_API_TOKEN` | Account-scoped Workers Scripts Edit token for the existing Worker. |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID for the Worker. |
| Variable | `VITE_SUPABASE_URL` | Production Supabase HTTPS project URL. |
| Variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser-safe Supabase publishable key. |

Keep Supabase Auth SMTP, templates, HTTPS Site URL, and allowed redirects configured as described in [account lifecycle rollout](account-lifecycle-rollout.md). The Cloudflare Worker is released exclusively by GitHub Actions.

## Release order and recovery

1. Merge a verified PR into `main`. Checks run on the merged commit.
2. The production job builds and checks the bundle. It verifies the commit is still the head of `main` and applies pending files with pinned Supabase CLI `db push`, using the existing `supabase_migrations.schema_migrations` history.
3. When the account function differs from the last published release, the job deploys `erp-accounts` and checks anonymous requests are rejected.
4. The job deploys the Cloudflare Worker and verifies its public health, security headers, and commit marker.

Historical migration filenames match the production ledger. The release stops if its verified cutover version is missing or the CLI detects divergent history. Keep applied migrations immutable and add new, later-timestamped migrations. Review compatibility with the previous portal and function because the database updates first.

A failed migration stops the release before either deployment. Earlier successful migrations stay recorded. Investigate the failure and use a reviewed forward fix when needed. Rerunning the current release skips recorded migrations. Keep production backups and recovery procedures current. Never run a database reset or history repair to unblock CI. For an application rollback, merge a reviewed code revert while retaining the applied migration files.

## Local verification

Use the Node version in `.nvmrc`. Run `npm --prefix fabric-poc run quality`, `node --test scripts/ci/*.test.mjs`, and Chromium against the synthetic CI configuration. For database checks, use a fresh disposable Docker project. Run `bash scripts/ci/prepare-database-project.sh`, start Supabase CLI 2.122.0 with `--workdir database/ci/project`, and run `scripts/ci/test-database.sh` and `scripts/ci/test-supabase-release.sh` with Bash. The workflow also runs the local account function and authenticated HTTP tests before discarding the database.
