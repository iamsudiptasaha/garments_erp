import { appendFileSync } from 'node:fs';
const {
  CLOUDFLARE_API_TOKEN: token,
  CLOUDFLARE_ACCOUNT_ID: account,
  CLOUDFLARE_PAGES_PROJECT: project,
  ROLLBACK_DEPLOYMENT_ID: id,
} = process.env;
if (
  !token ||
  !/^[a-f0-9]{32}$/i.test(account || '') ||
  !/^[a-z0-9][a-z0-9-]+$/.test(project || '') ||
  !/^[a-f0-9-]{36}$/i.test(id || '')
)
  throw Error('Invalid approved rollback configuration');
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}/deployments/${id}`;
const headers = { Authorization: `Bearer ${token}` };
const read = await fetch(base, { headers });
if (!read.ok) throw Error(`Cannot inspect rollback target (${read.status})`);
const original = await read.json();
const target = original.result;
if (
  !original.success ||
  target.environment !== 'production' ||
  target.deployment_trigger?.metadata?.branch !== 'main' ||
  target.latest_stage?.status !== 'success'
)
  throw Error('Rollback target must be a successful previous production deployment from main');
const result = await fetch(base + '/rollback', { method: 'POST', headers });
if (!result.ok || !(await result.json()).success) throw Error('Cloudflare rollback failed');
appendFileSync(
  process.env.GITHUB_STEP_SUMMARY || '/tmp/erp-rollback-summary.md',
  `Rolled back frontend deployment to \`${id}\`. Database unchanged.\n`,
);
console.log('Approved frontend rollback completed; database unchanged');
