import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMainRelease, productionProject } from './migrate-production.mjs';
import { publishedCommit } from './workers-deploy.mjs';

export function accountFunctionChanged(deployed, commit) {
  if (!/^[a-f0-9]{40}$/.test(deployed || '')) return true;
  return (
    spawnSync('git', [
      'diff',
      '--quiet',
      deployed,
      commit,
      '--',
      'supabase/functions/erp-accounts',
      'scripts/ci/deploy-accounts.mjs',
    ]).status !== 0
  );
}

async function deploy() {
  assertMainRelease(process.env);
  const { GITHUB_SHA, VITE_SUPABASE_URL, SUPABASE_ACCESS_TOKEN } = process.env;
  const projectOrigin = `https://${productionProject}.supabase.co`;
  if (new URL(VITE_SUPABASE_URL).origin !== projectOrigin)
    throw Error('The portal must use the production Supabase project.');

  // Use the published app rather than the preceding Git commit so a skipped or
  // failed release cannot silently omit a pending function update.
  if (!accountFunctionChanged(await publishedCommit(), GITHUB_SHA)) {
    console.log('The published release already includes this account function.');
    return;
  }
  if (!SUPABASE_ACCESS_TOKEN)
    throw Error('Configure SUPABASE_ACCESS_TOKEN for function deployment.');

  execFileSync(
    'npx',
    [
      '--yes',
      'supabase@2.122.0',
      'functions',
      'deploy',
      'erp-accounts',
      '--project-ref',
      productionProject,
      '--use-api',
      '--no-verify-jwt',
    ],
    { stdio: 'inherit' },
  );
  const gateway = await fetch(new URL('/functions/v1/erp-accounts', projectOrigin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(15000),
  });
  if (gateway.status !== 401)
    throw Error('ERP account function did not reject an anonymous request.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await deploy();
