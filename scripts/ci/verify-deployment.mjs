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
  const r = await fetch(new URL('/release.json', origin), {
    signal: AbortSignal.timeout(30000),
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!r.ok || (await r.json()).commit !== process.env.EXPECTED_COMMIT)
    throw Error('Hosted release does not match the approved commit');
  console.log('Deployed commit identity verified');
}
