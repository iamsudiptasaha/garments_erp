import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function deploymentConfig(env) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'push' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_REPOSITORY !== 'iamsudiptasaha/garments_erp' ||
    env.RELEASE_GATE_RESULT !== 'success'
  )
    throw Error('Deployment requires the successful GitHub main-push release gate.');
  if (
    !env.CLOUDFLARE_API_TOKEN ||
    !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || '') ||
    env.CLOUDFLARE_WORKER_NAME !== 'garments-erp' ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')
  )
    throw Error('Missing or invalid production Worker deployment configuration.');
  return { worker: env.CLOUDFLARE_WORKER_NAME, commit: env.GITHUB_SHA };
}

async function deploy() {
  const env = process.env;
  const config = deploymentConfig(env);
  const manifest = await import('node:fs/promises').then((fs) =>
    fs.readFile('fabric-poc/dist/release.json', 'utf8').then(JSON.parse),
  );
  if (manifest.commit !== config.commit) throw Error('Build does not match the release commit.');
  const origin = 'https://garments-erp.sahacreationsllp0int.workers.dev';
  const current = await fetch(origin + '/release.json', {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(30000),
  });
  if (current.ok && (await current.json()).commit === config.commit) {
    console.log('This exact commit is already deployed; duplicate upload avoided.');
    return;
  }
  if (!current.ok && current.status !== 404) throw Error('Cannot verify current deployment.');
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
