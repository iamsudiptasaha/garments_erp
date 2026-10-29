# Cloudflare Workers CI/CD

GitHub Actions runs coherence checks, lint, unused/duplicate checks, tests, build, catalogue verification and dependency audit. Only a successful `main` run can deploy; pull requests never deploy. The deployment uploads the exact verified build artifact using pinned Wrangler 4.156.0. No database migrations run in this workflow.

## One-time Cloudflare setup

Use an existing Worker or let Wrangler create `garments-erp` on its first deployment. This portal uses Workers Static Assets with the multi-page HTML routes preserved; no custom Worker server code is needed. Keep Workers Builds disabled for this same Worker when GitHub Actions owns deployment, to avoid deployments outside the quality gate.

In GitHub repository Settings → Secrets and variables → Actions, set:

| Kind | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Account-scoped token with Account → Cloudflare Workers → Edit |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| Variable | `CLOUDFLARE_WORKER_NAME` | Worker name (for example `garments-erp`) |
| Variable | `VITE_SUPABASE_URL` | Connected Supabase HTTPS project URL |
| Variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | Public browser publishable key; never a service-role key |

The Cloudflare credentials can instead be environment secrets on GitHub's `production` environment. If you configure required reviewers there, GitHub pauses deployment for their approval. Leave reviewers unset for automatic deployment after checks pass.

Until the Worker name variable is configured, CI continues normally and deployment is skipped. Once configured, missing browser configuration fails the build; missing credentials fail the deployment with a named error. Do not paste tokens into chat or source files.

## Publish and verify

Push to `main` or run **Verify and deploy Cloudflare Workers** manually on `main`. The `deploy` job follows the successful `verify` job. Wrangler prints the deployment URL. Production builds force the real authenticated workspace on the root and Fabric HTML entry points; the local preview retains its existing behaviour. HTML is not cached indefinitely; hashed assets are immutable.

Set the resulting production origin as the Supabase Auth Site URL and add its recovery/callback URLs to the redirect allowlist before testing recovery. Do not add unrelated preview origins automatically. Phone/password authentication and the existing guarded RPCs continue using Supabase.

Rollback using Cloudflare Workers → Deployments → an earlier successful production deployment → Rollback, or revert the offending Git commit and let the checks/deployment run again. Database migrations are not rolled back by a Workers rollback.

Official guide: https://developers.cloudflare.com/workers/static-assets/

The token should be scoped to the selected Cloudflare account. Account → Account Settings → Read may also be needed for account discovery when creating a new Worker. Never use a Global API Key. `wrangler.json` contains no credentials; production values are supplied through GitHub secrets/variables.
