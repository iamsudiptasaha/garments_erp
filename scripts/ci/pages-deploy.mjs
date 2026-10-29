import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const token = process.env.CLOUDFLARE_API_TOKEN,
  account = process.env.CLOUDFLARE_ACCOUNT_ID,
  project = process.env.CLOUDFLARE_PAGES_PROJECT,
  branch = process.env.DEPLOY_BRANCH;
if (
  !token ||
  !/^[a-f0-9]{32}$/i.test(account || '') ||
  !/^[a-z0-9][a-z0-9-]+$/.test(project || '') ||
  !['main', 'staging'].includes(branch)
)
  throw Error('Missing or invalid scoped Pages deployment configuration');
const r = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}`,
  { headers: { Authorization: `Bearer ${token}` } },
);
if (!r.ok) throw Error(`Unable to verify Pages project (${r.status})`);
const metadata = await r.json();
if (!metadata.success || metadata.result.production_branch !== 'main')
  throw Error('Pages project must exist with production branch main');
if (
  metadata.result.source?.config?.production_deployments_enabled ||
  metadata.result.source?.config?.preview_deployment_setting === 'all'
)
  throw Error(
    'Disable automatic Cloudflare Git builds; GitHub Actions is the deployment authority',
  );
if (
  branch === 'main' &&
  metadata.result.canonical_deployment?.deployment_trigger?.metadata?.commit_hash ===
    process.env.GITHUB_SHA
)
  throw Error('This commit is already deployed; duplicate deployment blocked');
const child = spawnSync(
  process.execPath,
  [
    resolve('deploy/cloudflare/node_modules/wrangler/bin/wrangler.js'),
    'pages',
    'deploy',
    resolve('fabric-poc/dist'),
    '--project-name=' + project,
    '--branch=' + branch,
    '--commit-hash=' + process.env.GITHUB_SHA,
  ],
  {
    cwd: resolve('deploy/cloudflare'),
    stdio: 'inherit',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CI: 'true',
      CLOUDFLARE_API_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: account,
      WRANGLER_SEND_METRICS: 'false',
    },
  },
);
if (child.status !== 0) process.exit(child.status || 1);
