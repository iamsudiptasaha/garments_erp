# Cloudflare Workers CI/CD

Production deployment is owned exclusively by GitHub Actions in `.github/workflows/verify.yml`. Merge a reviewed `dev` pull request into `main`; the resulting push runs quality/browser tests, dependency and secret scans, CodeQL and isolated database tests. Only a successful Release gate can start **Deploy production Worker**, subject to the existing `production` environment protections.

`dev`, pull requests, scheduled checks and manual CI dispatches never deploy this Worker. The deployment script also rejects a non-main/non-push context or a failed gate. Never invoke it locally or spoof CI variables. See `AGENTS.md` for the policy covering all production components.

The production job builds the checked commit with the three allowlisted public Vite settings, checks its bundle, deploys the existing `garments-erp` Worker using pinned Wrangler, then verifies HTTPS entries, security headers and the hosted commit. Re-running an already deployed commit avoids a duplicate upload. The application has no Cloudflare runtime dependency; this is a hosting adapter only.

## Required existing configuration

| Kind | Name | Purpose |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Account-scoped Workers Scripts edit token |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Selected account ID |
| Variable | `CLOUDFLARE_WORKER_NAME` | `garments-erp` |
| Variable | `VITE_SUPABASE_URL` | Production Supabase HTTPS URL |
| Variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser-safe public key |

Production environment secrets/variables can override repository values. Missing configuration fails deployment; it is never replaced by a manual deploy. Environment approvals remain GitHub-controlled. Do not enable separate Cloudflare Git builds for the same Worker.

The Pages release/rollback workflows are retained as proposals for a different hosting target; they do not run on a merge. They must not be activated as a second deployment authority for the same portal.

Rollback the portal through a reviewed Git revert merged into `main`, followed by the same CI gate and deployment. Never use dashboard/local rollbacks. Backend, mailer and database changes require their own reviewed main-branch Actions deployment workflows; this portal job does not automatically apply SQL or redeploy those components, and a missing workflow never authorizes manual deployment.
