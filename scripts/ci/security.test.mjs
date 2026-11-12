import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  hasCutoverHistory,
  productionDatabaseUrl,
  productionProject,
} from './migrate-production.mjs';
import { accountFunctionChanged } from './deploy-accounts.mjs';
import { deploymentConfig } from './workers-deploy.mjs';
const guard = resolve('scripts/ci/bundle-guard.mjs');
function bundle(content, name = 'app.js') {
  const dir = mkdtempSync(join(tmpdir(), 'erp-security-'));
  writeFileSync(join(dir, name), content);
  try {
    return spawnSync(process.execPath, [guard, dir], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test('bundle guard accepts the intentionally public publishable key', () => {
  assert.equal(bundle('const key="sb_publishable_ci_fixture"').status, 0);
});
test('bundle guard blocks privileged keys without echoing their contents', () => {
  const value = ['sb', 'secret', 'synthetic_testing_not_a_real_key'].join('_'),
    result = bundle('const key=' + JSON.stringify(value));
  assert.notEqual(result.status, 0);
  assert.ok(!result.stderr.includes(value));
});
test('bundle guard blocks service-role JWTs and data dumps', () => {
  const jwt = [
    Buffer.from('{"alg":"HS256"}').toString('base64url'),
    Buffer.from('{"role":"service_role"}').toString('base64url'),
    'synthetic_signature',
  ].join('.');
  assert.notEqual(bundle(jwt).status, 0);
  assert.notEqual(bundle('no business data', 'fixture.sql').status, 0);
});
test('disposable Supabase project has local copies of the canonical Auth templates', () => {
  const project = resolve('database/ci/project');
  const result = spawnSync('bash', [resolve('scripts/ci/prepare-database-project.sh')], {
    cwd: tmpdir(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const config = readFileSync(join(project, 'supabase/config.toml'), 'utf8');
  const paths = Array.from(config.matchAll(/^content_path = "([^"]+)"$/gm), ([, path]) => path);
  assert.deepEqual(paths, [
    './supabase/templates/employee-invite.html',
    './supabase/templates/employee-recovery.html',
    './supabase/templates/employee-email-change.html',
  ]);
  for (const path of paths) {
    assert.deepEqual(readFileSync(join(project, path)), readFileSync(resolve(path)));
  }
});
test('database guard refuses all remote targets', () => {
  const result = spawnSync(process.execPath, ['scripts/ci/assert-test-db.mjs'], {
    env: {
      ...process.env,
      TEST_DATABASE_URL: 'postgresql://fake:fake@example.invalid:55422/postgres',
    },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.ok(!result.stderr.includes('fake:fake'));
});
test('Worker release refuses local execution, PRs, other branches and other repositories', () => {
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'iamsudiptasaha/garments_erp',
    CLOUDFLARE_API_TOKEN: 'synthetic-token',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    GITHUB_SHA: 'b'.repeat(40),
  };
  assert.equal(deploymentConfig(env).worker, 'garments-erp');
  for (const change of [
    { GITHUB_ACTIONS: 'false' },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/heads/dev' },
    { GITHUB_REPOSITORY: 'someone/else' },
    { CLOUDFLARE_API_TOKEN: '' },
  ])
    assert.throws(() => deploymentConfig({ ...env, ...change }));
});

test('production migrations accept only the pinned project and force certificate verification', () => {
  const valid = `postgresql://postgres.${productionProject}:fake@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=disable`;
  const url = new URL(productionDatabaseUrl(valid));
  assert.equal(url.searchParams.get('sslmode'), 'verify-full');
  assert.match(url.searchParams.get('sslrootcert'), /supabase-prod-ca-2021\.crt$/);
  for (const value of [
    valid.replace('5432', '6543'),
    valid.replace(productionProject, 'another-project'),
    valid.replace('supabase.com', 'example.invalid'),
    valid.replace('/postgres?', '/other?'),
  ])
    assert.throws(() => productionDatabaseUrl(value));
  const history = (remote) => JSON.stringify({ migrations: [{ local: '20261112113000', remote }] });
  assert.ok(hasCutoverHistory(history('20261112113000')));
  assert.ok(!hasCutoverHistory(history('')));
  assert.ok(hasCutoverHistory('   20261112113000 | 20261112113000 | 2026-11-12 11:30:00'));
  assert.ok(hasCutoverHistory('   `20261112113000` | `20261112113000` | `2026-11-12 11:30:00`'));
  assert.ok(!hasCutoverHistory('   20261112113000 |                | 2026-11-12 11:30:00'));
});

test('account release compares the deployed tree and deploys if that commit is unavailable', () => {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(accountFunctionChanged(commit, commit), false);
  assert.equal(accountFunctionChanged('a'.repeat(40), commit), true);
  assert.equal(accountFunctionChanged(undefined, commit), true);
});
