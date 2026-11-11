import test from 'node:test';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  migrationConfig,
  migrationBody,
  applyRelease,
  releaseFailure,
  releaseMigrationFiles,
} from './database-release.mjs';
test('release list covers every tracked migration after the baseline', () => {
  assert.ok(releaseMigrationFiles().length > 0);
});

test('every release migration has the transaction wrapper required by the runner', () => {
  for (const file of releaseMigrationFiles()) {
    const sql = readFileSync(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8');
    assert.doesNotThrow(() => migrationBody(sql), file);
  }
});

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

test('failure diagnostics expose safe codes, never arbitrary database error contents', () => {
  const error = new AggregateError([
    { code: 'ENETUNREACH', message: 'private connection details' },
  ]);
  assert.equal(releaseFailure(error), 'Database/connection failure codes: ENETUNREACH');
  assert.equal(
    releaseFailure(new Error('private password or row values')),
    'Unexpected failure; raw error details suppressed.',
  );
});

test('production connection pins the official Supabase CA without disabling verification', () => {
  const ssl = migrationConfig(env).ssl;
  const cert = new X509Certificate(ssl.ca);
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(cert.ca, true);
  assert.equal(
    cert.fingerprint256,
    '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
  );
});
