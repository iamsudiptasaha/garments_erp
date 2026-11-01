import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from '../../fabric-poc/node_modules/pg/lib/index.js';
const project = 'kidvckaicclqvtlddeyz';
const files = [
  '20261031191218_employee_hr_workspace.sql',
  '20261031201306_contact_primary_selections.sql',
];
export function migrationConfig(env) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_REPOSITORY !== 'iamsudiptasaha/garments_erp' ||
    env.RELEASE_GATE_RESULT !== 'success' ||
    env.EXPECTED_COMMIT !== env.GITHUB_SHA ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') ||
    env.CONFIRM_PROJECT !== project ||
    (env.BACKUP_CONFIRMED !== 'true' &&
      env.BACKUP_EXCEPTION !== 'OWNER APPROVED WITHOUT VERIFIED BACKUP')
  )
    throw Error(
      'Requires approved main workflow, exact commit, passing CI, correct project and backup decision.',
    );
  if (!env.PRODUCTION_DATABASE_URL)
    throw Error('Configure PRODUCTION_DATABASE_URL in the production environment.');
  let url;
  try {
    url = new URL(env.PRODUCTION_DATABASE_URL);
  } catch {
    throw Error('Invalid database connection configuration.');
  }
  const direct =
    url.hostname === `db.${project}.supabase.co` && decodeURIComponent(url.username) === 'postgres';
  const pooler =
    /^[a-z0-9-]+\.[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    decodeURIComponent(url.username) === `postgres.${project}` &&
    url.port === '5432';
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.pathname !== '/postgres' ||
    !(direct || pooler) ||
    !url.password ||
    (direct && url.port && url.port !== '5432')
  )
    throw Error(
      'Only the approved production project direct/session-pooler connection is permitted.',
    );
  // No URL SSL options may downgrade certificate validation.
  return {
    host: url.hostname,
    port: 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: 'postgres',
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15000,
    application_name: 'garments-erp-reviewed-migration',
  };
}
export function migrationBody(sql) {
  const start = sql.match(/^(?:\s|--[^\n]*\n)*begin;/i);
  if (!start || !/commit;\s*$/i.test(sql))
    throw Error('Migration must have an explicit transaction wrapper.');
  return sql.slice(start[0].length).replace(/commit;\s*$/i, '');
}
export async function applyRelease(client, migrations) {
  await client.query('begin');
  try {
    await client.query("set local lock_timeout='10s'");
    await client.query("set local statement_timeout='60s'");
    await client.query('select pg_advisory_xact_lock(713491,20261101)');
    const anchor = await client.query(
      "select 1 from supabase_migrations.schema_migrations where version='20261031182953'",
    );
    if (anchor.rowCount !== 1)
      throw Error('Required previously deployed database baseline is missing.');
    for (const migration of migrations) {
      const previous = await client.query(
        'select name, statements from supabase_migrations.schema_migrations where version=$1',
        [migration.version],
      );
      if (previous.rowCount) {
        if (
          previous.rows[0].name !== migration.name ||
          JSON.stringify(previous.rows[0].statements) !== JSON.stringify([migration.sql])
        )
          throw Error('Applied migration history differs from this reviewed release.');
        continue;
      }
      await client.query(migrationBody(migration.sql));
      await client.query(
        'insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3::text[])',
        [migration.version, migration.name, [migration.sql]],
      );
    }
    // Verify schema, indexes and security before committing either migration.
    const result = await client.query(`select
      to_regprocedure('public.erp_save_employee(jsonb,uuid)') is not null
      and to_regprocedure('public.erp_employee_snapshot()') is not null
      and to_regprocedure('public.erp_employee_attestation(uuid,bigint,jsonb)') is not null
      and not has_function_privilege('anon','public.erp_save_employee(jsonb,uuid)','execute')
      and (select relrowsecurity from pg_class where oid='garments_access.employee_attestation'::regclass)
      and not has_table_privilege('authenticated','garments_access.employee_attestation','select')
      and (select count(*)=3 from pg_indexes where schemaname='garments_erp' and indexname in ('contact_items_one_primary_address','contact_items_one_primary_phone','contact_bank_account_one_primary') and indexdef like 'CREATE UNIQUE INDEX%WHERE%')
      and (select count(*)=3 from information_schema.columns where table_schema='garments_erp' and ((table_name='contact_items' and column_name in ('primary_address','primary_phone')) or (table_name='contact_bank_account' and column_name='primary_bank_account')) and data_type='boolean' and is_nullable='NO' and column_default='false') as valid`);
    if (result.rows[0]?.valid !== true)
      throw Error('Post-migration schema/security verification failed.');
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}
async function run() {
  const config = migrationConfig(process.env);
  const current = await fetch(
    'https://api.github.com/repos/iamsudiptasaha/garments_erp/git/ref/heads/main',
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!current.ok || (await current.json()).object?.sha !== process.env.GITHUB_SHA)
    throw Error('Main advanced or could not be verified; dispatch the latest reviewed commit.');
  const migrations = files.map((file) => {
    const sql = readFileSync('supabase/migrations/' + file, 'utf8');
    return {
      version: file.split('_')[0],
      name: file.replace(/^\d+_|\.sql$/g, ''),
      sql,
      hash: createHash('sha256').update(sql).digest('hex'),
    };
  });
  const client = new pg.Client(config);
  try {
    await client.connect();
    await applyRelease(client, migrations);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Production database migration verified for commit ${process.env.GITHUB_SHA}.\n\nBackup decision: ${process.env.BACKUP_CONFIRMED === 'true' ? 'verified backup confirmed' : 'owner explicitly approved proceeding without a verified backup'}.\n\n` +
          migrations.map((m) => `- ${m.version}: ${m.hash}`).join('\n') +
          '\n',
      );
    console.log('Approved employee/contact database release committed and verified.');
  } finally {
    await client.end();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  run().catch((error) => {
    // Database errors may contain connection details or row values. Never print them.
    console.error(
      'Database release stopped. No successful migration is claimed.',
      error.code
        ? `SQLSTATE ${/^[A-Z0-9]{5}$/.test(error.code) ? error.code : 'unavailable'}`
        : 'Check release configuration and approval.',
    );
    process.exitCode = 1;
  });
