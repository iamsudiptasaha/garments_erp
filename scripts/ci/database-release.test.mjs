import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationConfig, migrationBody, applyRelease } from './database-release.mjs';
const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY: 'iamsudiptasaha/garments_erp',
  RELEASE_GATE_RESULT: 'success',
  GITHUB_SHA: 'a'.repeat(40),
  EXPECTED_COMMIT: 'a'.repeat(40),
  CONFIRM_PROJECT: 'kidvckaicclqvtlddeyz',
  BACKUP_CONFIRMED: 'true',
  PRODUCTION_DATABASE_URL:
    'postgresql://postgres:fixture@db.kidvckaicclqvtlddeyz.supabase.co:5432/postgres',
};
test('database release requires exact approved main context and successful checks', () => {
  for (const patch of [
    { GITHUB_ACTIONS: 'false' },
    { GITHUB_REF: 'refs/heads/dev' },
    { RELEASE_GATE_RESULT: 'failure' },
    { EXPECTED_COMMIT: 'b'.repeat(40) },
    { BACKUP_CONFIRMED: 'false' },
    { CONFIRM_PROJECT: 'other' },
    { PRODUCTION_DATABASE_URL: '' },
  ])
    assert.throws(() => migrationConfig({ ...env, ...patch }));
  assert.equal(migrationConfig(env).ssl.rejectUnauthorized, true);
});
test('database connection target and TLS cannot be redirected or downgraded', () => {
  for (const url of [
    'postgresql://postgres:fixture@evil.invalid/postgres',
    'postgresql://postgres.other:fixture@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
    'postgresql://postgres.kidvckaicclqvtlddeyz:fixture@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
  ])
    assert.throws(() => migrationConfig({ ...env, PRODUCTION_DATABASE_URL: url }));
  assert.equal(
    migrationConfig({
      ...env,
      PRODUCTION_DATABASE_URL:
        'postgresql://postgres.kidvckaicclqvtlddeyz:fixture@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
    }).port,
    5432,
  );
  assert.equal(
    migrationConfig({
      ...env,
      PRODUCTION_DATABASE_URL: env.PRODUCTION_DATABASE_URL + '?sslmode=no-verify',
    }).ssl.rejectUnauthorized,
    true,
  );
});
test('only outer migration transaction is removed', () => {
  assert.equal(
    migrationBody('-- reviewed\nbegin;\nDO $$ begin null; end $$;\ncommit;').trim(),
    'DO $$ begin null; end $$;',
  );
  assert.throws(() => migrationBody('select 1;'));
});
test('a failed second migration rolls back the entire database release', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes("version='20261031182953'")) return { rowCount: 1 };
      if (sql.startsWith('select name')) return { rowCount: 0 };
      if (sql.trim() === 'fail;') throw Error('synthetic failure');
      return { rows: [] };
    },
  };
  await assert.rejects(() =>
    applyRelease(client, [
      { version: '1', name: 'first', sql: 'begin; select 1; commit;' },
      { version: '2', name: 'second', sql: 'begin; fail; commit;' },
    ]),
  );
  assert.equal(calls.at(-1), 'rollback');
  assert.equal(calls.includes('commit'), false);
});

test('explicit owner backup exception is audited separately and cannot waive CI or branch checks', () => {
  const waived = {
    ...env,
    BACKUP_CONFIRMED: 'false',
    BACKUP_EXCEPTION: 'OWNER APPROVED WITHOUT VERIFIED BACKUP',
  };
  assert.equal(migrationConfig(waived).ssl.rejectUnauthorized, true);
  assert.throws(() => migrationConfig({ ...waived, RELEASE_GATE_RESULT: 'failure' }));
  assert.throws(() => migrationConfig({ ...waived, GITHUB_REF: 'refs/heads/dev' }));
  assert.throws(() => migrationConfig({ ...waived, BACKUP_EXCEPTION: 'yes' }));
});
