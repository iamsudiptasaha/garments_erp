# Cloudflare Workers CI/CD

The existing `garments-erp` Worker hosts the portable Vite build from `fabric-poc/dist`. The [GitHub Actions release](secure-ci-setup.md) uses pinned Wrangler and `deploy/cloudflare/workers.json` after successful checks, Supabase migrations, and any required account function update. The application has no Cloudflare runtime dependency.

The release verifies the public HTTPS app, security headers, and the published commit. Rerunning an already published commit avoids a duplicate Worker upload. Release an application revert through the same reviewed `main` path and retain applied database migrations.
