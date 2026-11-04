import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function verifyCommit(origin, expected, retryDelay = 2000) {
  let observed;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt) await sleep(retryDelay);
    const response = await fetch(new URL('/release.json', origin), {
      signal: AbortSignal.timeout(5000),
      headers: { 'Cache-Control': 'no-cache' },
    });
    observed = response.ok ? (await response.json()).commit : `HTTP ${response.status}`;
    if (observed === expected) return;
  }
  throw Error(
    `Hosted release does not match the approved commit (expected ${expected}, observed ${observed})`,
  );
}

async function verifyDeployment() {
  const origin = new URL(process.env.DEPLOYMENT_URL || '');
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw Error('Deployment URL must be a clean HTTPS origin');
  for (const path of ['/', '/access.html', '/fabric.html']) {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(30000) });
    if (!response.ok)
      throw Error(`Deployment verification failed: ${path} returned ${response.status}`);
    const html = await response.text();
    if (!html.includes('<script') || !html.includes('root'))
      throw Error(`Deployment entry ${path} is incomplete`);
    if (response.headers.get('x-content-type-options') !== 'nosniff')
      throw Error('Missing deployment security header');
  }
  console.log('HTTPS entry points and required headers verified');

  if (process.env.EXPECTED_COMMIT) {
    await verifyCommit(origin, process.env.EXPECTED_COMMIT);
    console.log('Deployed commit identity verified');
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  await verifyDeployment();
