import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMainRelease } from './migrate-production.mjs';

export const productionOrigin = 'https://garments-erp.sahacreationsllp0int.workers.dev';

export async function publishedCommit() {
  try {
    const response = await fetch(productionOrigin + '/release.json', {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) return (await response.json()).commit;
  } catch {
    // A missing or unhealthy old deployment must not block publishing a fix.
  }
  return null;
}

export function deploymentConfig(env) {
  assertMainRelease(env);
  if (
    !env.CLOUDFLARE_API_TOKEN ||
    !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || '') ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')
  )
    throw Error('Missing or invalid production Worker deployment configuration.');
  return { worker: 'garments-erp', commit: env.GITHUB_SHA };
}

async function deploy() {
  const env = process.env;
  const config = deploymentConfig(env);
  const manifest = await import('node:fs/promises').then((fs) =>
    fs.readFile('fabric-poc/dist/release.json', 'utf8').then(JSON.parse),
  );
  if (manifest.commit !== config.commit) throw Error('Build does not match the release commit.');
  if ((await publishedCommit()) === config.commit) {
    console.log('This exact commit is already deployed; duplicate upload avoided.');
    return;
  }
  const child = spawnSync(
    process.execPath,
    [
      resolve('deploy/cloudflare/node_modules/wrangler/bin/wrangler.js'),
      'deploy',
      '--config',
      resolve('deploy/cloudflare/workers.json'),
      '--name',
      config.worker,
    ],
    {
      stdio: 'inherit',
      env: {
        PATH: env.PATH,
        HOME: env.HOME,
        CI: 'true',
        CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
        CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
        WRANGLER_SEND_METRICS: 'false',
      },
    },
  );
  if (child.status !== 0) throw Error('Cloudflare Worker deployment failed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await deploy();
