import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
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
