import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from '../../fabric-poc/node_modules/pg/lib/index.js';
class ReleaseError extends Error {}
const project = 'kidvckaicclqvtlddeyz';
const files = [
  '20261104172129_align_erp_diagram_relationships.sql',
  '20261104195714_lab_dip_version_status_items.sql',
  '20261105135706_production_hub_and_review_ownership.sql',
  '20261105152128_employee_photo_attachment_and_checklist.sql',
  '20261105161411_verify_dyed_bills_and_batch_references.sql',
  '20261105173810_production_atomic_employee_handover.sql',
  '20261105192048_add_item_batch_number.sql',
  '20261106054224_connect_production_workspace.sql',
  '20261107132756_finished_products.sql',
  '20261107175500_transport_docket_ownership.sql',
  '20261107181537_billing_packing_dispatch.sql',
  '20261108090000_sellable_product.sql',
  '20261108100000_po_billing_alignment.sql',
  '20261108110000_align_billing_er.sql',
  '20261108120100_variant_item_per_job_billed_price.sql',
  '20261108130000_return_bill_composition.sql',
  '20261108135000_checkout_variant.sql',
  '20261108140000_item_costing.sql',
  '20261108145000_remove_checkout_item_part.sql',
  '20261108150000_raw_material_transactions.sql',
  '20261109072811_move_erp_objects_out_of_access.sql',
  '20261109101000_seed_production_stages.sql',
  '20261109102000_item_costing_classification.sql',
  '20261109103000_require_finalized_production_costing.sql',
  '20261109104000_item_costing_read.sql',
  '20261109105000_item_costing_write.sql',
  '20261109140609_finished_goods_costing_valuation.sql',
  '20261109142922_finished_goods_catalogue.sql',
];
// Files before the first release migration belong to the deployed baseline.
export function releaseMigrationFiles() {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'supabase/migrations/*.sql'], {
    encoding: 'utf8',
  })
    .split('\0')
    .map((path) => path.split('/').at(-1))
    .filter((file) => file >= files[0])
    .sort();
  if (tracked.join('\n') !== files.join('\n')) {
    const missing = tracked.filter((file) => !files.includes(file));
    const untracked = files.filter((file) => !tracked.includes(file));
    throw new ReleaseError(
      `Migration release list differs from Git. Missing: ${missing.join(', ') || 'none'}. Untracked: ${untracked.join(', ') || 'none'}.`,
    );
  }
  return files.slice();
}
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
    throw new ReleaseError(
      'Requires approved main workflow, exact commit, passing CI, correct project and backup decision.',
    );
  if (!env.PRODUCTION_DATABASE_URL)
    throw new ReleaseError('Configure PRODUCTION_DATABASE_URL in the production environment.');
  let url;
  try {
    url = new URL(env.PRODUCTION_DATABASE_URL);
  } catch {
    throw new ReleaseError('Invalid database connection configuration.');
  }
  const direct =
    url.hostname === `db.${project}.supabase.co` && decodeURIComponent(url.username) === 'postgres';
  const pooler =
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    decodeURIComponent(url.username) === `postgres.${project}` &&
    url.port === '5432';
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.pathname !== '/postgres' ||
    !(direct || pooler) ||
    !url.password ||
    (direct && url.port && url.port !== '5432')
  )
    throw new ReleaseError(
      'Only the approved production project direct/session-pooler connection is permitted.',
    );
  // No URL SSL options may downgrade certificate validation.
  return {
    host: url.hostname,
    port: 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: 'postgres',
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync(
        new URL('../../database/certificates/supabase-prod-ca-2021.crt', import.meta.url),
        'utf8',
      ),
    },
    connectionTimeoutMillis: 15000,
    application_name: 'garments-erp-reviewed-migration',
  };
}
export function migrationBody(sql) {
  const start = sql.match(/^(?:\s|--[^\n]*\n)*begin;/i);
  if (!start || !/commit;\s*$/i.test(sql))
    throw new ReleaseError('Migration must have an explicit transaction wrapper.');
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
      throw new ReleaseError('Required previously deployed database baseline is missing.');
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
          throw new ReleaseError('Applied migration history differs from this reviewed release.');
        continue;
      }
      await client.query(migrationBody(migration.sql));
      await client.query(
        'insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3::text[])',
        [migration.version, migration.name, [migration.sql]],
      );
    }
    // Verify the existing baseline and the new schema before committing.
    const result = await client.query(`select
      to_regprocedure('public.erp_save_employee(jsonb,uuid)') is not null
      and to_regprocedure('public.erp_employee_snapshot()') is not null
      and to_regprocedure('public.erp_employee_attestation(uuid,bigint,jsonb)') is not null
      and not has_function_privilege('anon','public.erp_save_employee(jsonb,uuid)','execute')
      and (select relrowsecurity from pg_class where oid='garments_erp.employee_attestation'::regclass)
      and not has_table_privilege('authenticated','garments_erp.employee_attestation','select')
      and (select count(*)=3 from pg_indexes where schemaname='garments_erp' and indexname in ('contact_items_one_primary_address','contact_items_one_primary_phone','contact_bank_account_one_primary') and indexdef like 'CREATE UNIQUE INDEX%WHERE%')
      and (select count(*)=3 from information_schema.columns where table_schema='garments_erp' and ((table_name='contact_items' and column_name in ('primary_address','primary_phone')) or (table_name='contact_bank_account' and column_name='primary_bank_account')) and data_type='boolean' and is_nullable='NO' and column_default='false')
      and to_regclass('garments_erp.job_status_history') is null
      and (select count(*)=0 from information_schema.columns where table_schema='garments_erp'
        and table_name='lab_dip_version' and column_name in ('date','comments','lab_dip_status_id'))
      and (select count(*)=7 from pg_class where oid in (
        'garments_erp.production'::regclass,'garments_erp.task_board_data'::regclass,
        'garments_erp.flags_list'::regclass,'garments_erp.task_board_data_flag'::regclass,
        'garments_erp.job_item_status_list'::regclass,'garments_erp.job_transition_log'::regclass,
        'garments_erp.lab_dip_version_item'::regclass
      ) and relrowsecurity and not has_table_privilege('authenticated',oid,'select,insert,update,delete')
        and not has_table_privilege('anon',oid,'select,insert,update,delete'))
      and to_regprocedure('public.erp_move_production(jsonb,uuid)') is not null
      and not has_function_privilege('anon','public.erp_move_production(jsonb,uuid)','execute')
      and to_regprocedure('public.erp_set_employee_active(bigint,boolean,text)') is not null
      and exists(select 1 from pg_indexes where schemaname='garments_erp'
        and indexname='lab_dip_version_item_one_latest' and indexdef like 'CREATE UNIQUE INDEX%WHERE%')
      and exists(select 1 from pg_indexes where schemaname='garments_erp'
        and indexname='job_one_current_per_production' and indexdef like 'CREATE UNIQUE INDEX%WHERE%')
      and exists(select 1 from pg_constraint where conrelid='garments_erp.raw_material_check_in'::regclass
        and conname='raw_material_receipt_line_material_identity' and contype='f' and convalidated)
      and not exists(select 1 from garments_erp.production p where
        (select count(*) from garments_erp.job j where j.production_id=p.id and latest)<>1
        or (select count(*) from garments_erp.task_board_data b where b.production_id=p.id)<>1)
      and exists(select 1 from pg_constraint where conrelid='garments_erp.employee'::regclass
        and conname='employee_photo_fkey' and contype='f' and convalidated)
      and exists(select 1 from information_schema.columns where table_schema='garments_erp'
        and table_name='employee' and column_name='employee_photo' and data_type='bigint')
      and not exists(select 1 from information_schema.columns where table_schema='garments_erp'
        and table_name='production_checklist' and column_name='tna_acquired_status_id')
      and exists(select 1 from garments_erp.app_file_route where target_key='employeePhoto'
        and allowed_mime_types=array['image/jpeg','image/png','image/webp'] and is_active)
      and to_regprocedure('public.erp_save_verified_dyed_bill(jsonb,uuid)') is not null
      and not has_function_privilege('anon','public.erp_save_verified_dyed_bill(jsonb,uuid)','execute')
      and not has_function_privilege('authenticated','garments_erp.save_fabric_document_core(text,jsonb,text,jsonb,bigint)','execute')
      and (select relrowsecurity from pg_class where oid='garments_erp.dyed_bill_attestation'::regclass)
      and not has_table_privilege('authenticated','garments_erp.dyed_bill_attestation','select,insert,update,delete')
      and exists(select 1 from pg_constraint where conrelid='garments_erp.dyeing_program_item'::regclass and contype='f'
        and pg_get_constraintdef(oid)='FOREIGN KEY (batch_no) REFERENCES garments_erp.batch_no_lab_dip_version_map(id)')
      and to_regclass('garments_erp.return_mode_type') is not null
      and to_regclass('garments_erp.return_bill_item_piece_per_size') is not null
      and exists(select 1 from pg_constraint
        where conrelid='garments_erp.raw_material_check_out'::regclass
          and contype='f'
          and pg_get_constraintdef(oid)='FOREIGN KEY (variant_item_id) REFERENCES garments_erp.variant_item(id)')
      and to_regclass('garments_erp.item_costing') is not null
      and to_regclass('garments_erp.item_costing_item') is not null
      and not exists(select 1 from information_schema.columns
        where table_schema='garments_erp' and table_name='raw_material_check_out'
          and column_name='item_part_id')
      and to_regprocedure('public.erp_save_raw_material_transaction(text,bigint,timestamptz,jsonb)') is not null
      and to_regprocedure('public.erp_raw_material_transaction_snapshot()') is not null
      and to_regprocedure('public.erp_save_raw_material_setup(text,bigint,timestamptz,jsonb,jsonb)') is not null
      and not has_function_privilege('anon','public.erp_save_raw_material_transaction(text,bigint,timestamptz,jsonb)','execute')
      and not has_function_privilege('anon','public.erp_raw_material_transaction_snapshot()','execute')
      and not has_function_privilege('anon','public.erp_save_raw_material_setup(text,bigint,timestamptz,jsonb,jsonb)','execute')
      as valid`);
    if (result.rows[0]?.valid !== true)
      throw new ReleaseError('Post-migration schema/security verification failed.');
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}
async function run() {
  const config = migrationConfig(process.env);
  console.log('Release context and production target validated.');
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
    throw new ReleaseError(
      'Main advanced or could not be verified; dispatch the latest reviewed commit.',
    );
  const migrations = releaseMigrationFiles().map((file) => {
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
    console.log('Current main commit verified; connecting to production database.');
    await client.connect();
    console.log('Production connection established; applying fixed migration transaction.');
    await applyRelease(client, migrations);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Production database migration verified for commit ${process.env.GITHUB_SHA}.\n\nBackup decision: ${process.env.BACKUP_CONFIRMED === 'true' ? 'verified backup confirmed' : 'owner explicitly approved proceeding without a verified backup'}.\n\n` +
          migrations.map((m) => `- ${m.version}: ${m.hash}`).join('\n') +
          '\n',
      );
    console.log('Approved ERP diagram migration committed and verified.');
  } finally {
    await client.end();
  }
}
export function releaseFailure(error) {
  if (error instanceof ReleaseError) return error.message;
  const codes = [error, ...(Array.isArray(error.errors) ? error.errors : [])]
    .map((e) => e?.code)
    .filter((code) => typeof code === 'string' && /^[A-Z0-9_]{3,64}$/.test(code));
  return codes.length
    ? 'Database/connection failure codes: ' + [...new Set(codes)].join(', ')
    : 'Unexpected failure; raw error details suppressed.';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  run().catch((error) => {
    console.error(
      'Database release stopped; no successful migration is claimed.',
      releaseFailure(error),
    );
    process.exitCode = 1;
  });
