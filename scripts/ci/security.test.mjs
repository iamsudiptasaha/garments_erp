import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
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
test('Worker release refuses local execution, PRs, other branches and failed gates', () => {
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'iamsudiptasaha/garments_erp',
    RELEASE_GATE_RESULT: 'success',
    CLOUDFLARE_API_TOKEN: 'synthetic-token',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    CLOUDFLARE_WORKER_NAME: 'garments-erp',
    GITHUB_SHA: 'b'.repeat(40),
  };
  assert.equal(deploymentConfig(env).worker, 'garments-erp');
  for (const change of [
    { GITHUB_ACTIONS: 'false' },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/heads/dev' },
    { RELEASE_GATE_RESULT: 'failure' },
    { GITHUB_REPOSITORY: 'someone/else' },
    { CLOUDFLARE_WORKER_NAME: 'other-worker' },
    { CLOUDFLARE_API_TOKEN: '' },
  ])
    assert.throws(() => deploymentConfig({ ...env, ...change }));
});
