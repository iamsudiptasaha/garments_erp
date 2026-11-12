import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const productionProject = 'kidvckaicclqvtlddeyz';
const cutoverVersion = '20261112113000';
const cli = ['--yes', 'supabase@2.122.0'];

export function assertMainRelease(env) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'push' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_REPOSITORY !== 'iamsudiptasaha/garments_erp'
  )
    throw Error('Production release requires a push to main in the GitHub Actions repository.');
}

export function productionDatabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('Configure PRODUCTION_DATABASE_URL for the production Supabase project.');
  }
  const direct =
    url.hostname === `db.${productionProject}.supabase.co` && url.username === 'postgres';
  const pooler =
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    url.username === `postgres.${productionProject}`;
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !(direct || pooler) ||
    (url.port && url.port !== '5432') ||
    url.pathname !== '/postgres' ||
    !url.password
  )
    throw Error('Use the production project direct or session pooler connection on port 5432.');
  url.search = '';
  url.hash = '';
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set(
    'sslrootcert',
    fileURLToPath(
      new URL('../../database/certificates/supabase-prod-ca-2021.crt', import.meta.url),
    ),
  );
  return url.toString();
}

export function hasCutoverHistory(output) {
  if (output.trimStart().startsWith('{')) {
    const { migrations } = JSON.parse(output);
    return (
      Array.isArray(migrations) &&
      migrations.some(({ local, remote }) => local === cutoverVersion && remote === cutoverVersion)
    );
  }
  // CLI 2.122.0 can also render the same history as a table.
  return output.split('\n').some((line) => {
    const [local, remote] = line.split('|').map((cell) => cell.replaceAll('`', '').trim());
    return local === cutoverVersion && remote === cutoverVersion;
  });
}

function migrate() {
  assertMainRelease(process.env);
  if (new URL(process.env.VITE_SUPABASE_URL).origin !== `https://${productionProject}.supabase.co`)
    throw Error('The portal must use the production Supabase project.');
  const target = ['--db-url', productionDatabaseUrl(process.env.PRODUCTION_DATABASE_URL)];
  const options = { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } };
  const history = spawnSync('npx', [...cli, 'migration', 'list', ...target], options);
  if (history.status !== 0)
    throw Error(
      'Supabase could not read migration history. Check the production database connection.',
    );
  if (!hasCutoverHistory(history.stdout))
    throw Error('Production migration baseline is missing. Release stopped before applying SQL.');

  const push = spawnSync('npx', [...cli, 'db', 'push', ...target, '--yes'], {
    ...options,
    stdio: 'inherit',
  });
  if (push.status !== 0) throw Error('Supabase migration failed. Deployment stopped.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) migrate();
