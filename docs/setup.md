# Setup and delivery

## Local development

Use the committed lockfile with `npm ci` in `fabric-poc/`. Run `npm test` and `npm run build` before a review. Browser-check the affected screen in addition to unit tests; the unit tests do not establish that a third-party grid's input handling works.

The base files do not require live Supabase access. `.env.example` contains placeholders only. Real `.env` files, generated builds, dependencies and local logs are ignored by Git.

## Future browser configuration

If/when a live data adapter is added, copy `fabric-poc/.env.example` to `fabric-poc/.env.local`. Browser code may use a Supabase publishable key; never put a secret or legacy service-role key into a `VITE_` variable. Every `VITE_` variable is potentially bundled into publicly readable browser code.

`src/foundation/environment.js` validates the intended names but deliberately does not create a client or connect to the database. It defaults to demo mode. Live mode is not implemented merely by filling in these placeholders.

Current key guidance: https://supabase.com/docs/guides/getting-started/api-keys

## First GitHub delivery

The existing private origin is `iamsudiptasaha/garments_erp`. No commit or push was created during local setup. The GitHub connector can access this repository; shell Git authentication may need separate configuration.

The remote initial commit contains only its original README. It was fetched and established as the local baseline without overwriting working files; local `main` tracks `origin/main`. Before the first upload, review local changes and confirm the first new commit. Keep the existing private visibility and do not force-push.

The verification workflow runs `npm ci`, `npm test` and `npm run build`. It intentionally has no deployment step and no database credentials. Add deployment only after the Fabric acceptance review and an agreed hosting target.

## Dependency review

FortuneSheet 1.0.4 currently brings a `uuid` advisory (GHSA-w5hq-g745-h8pq) through its core package. The prototype documentation records this finding. Before production, assess reachability or an upstream fix; do not blindly force a major dependency override. A successful build alone does not resolve that advisory.
