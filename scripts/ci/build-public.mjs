import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { readEnvironment } from '../../fabric-poc/src/foundation/release-config.ts';
const allowed = new Set(['VITE_DATA_MODE', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']);
for (const key of Object.keys(process.env))
  if (key.startsWith('VITE_') && !allowed.has(key))
    throw Error(`Unreviewed browser environment variable: ${key}`);
readEnvironment(process.env);
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  CI: process.env.CI,
  DEPLOY_BUILD: '1',
  NODE_ENV: 'production',
};
for (const key of allowed) if (process.env[key]) env[key] = process.env[key];
const result = spawnSync(
  process.execPath,
  [resolve('fabric-poc/node_modules/vite/bin/vite.js'), 'build'],
  { cwd: resolve('fabric-poc'), env, stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status || 1);

writeFileSync(
  'fabric-poc/dist/release.json',
  JSON.stringify({ commit: process.env.GITHUB_SHA || 'local' }, null, 2),
);
