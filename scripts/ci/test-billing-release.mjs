import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from '../../fabric-poc/node_modules/pg/lib/index.js';
import { applyRelease } from './database-release.mjs';

const [database, ...files] = process.argv.slice(2);
assert.match(database, /^billing_review_\d+_[a-f0-9]{8}$/);
const migrations = files.map((file) => {
  const [, version, name] = file.match(/^supabase\/migrations\/(20261112\d{6})_(\w+)\.sql$/);
  return { version, name, sql: readFileSync(file, 'utf8') };
});
assert.ok(migrations.length > 1);
assert.deepEqual(
  migrations.map(({ version }) => version),
  [...new Set(migrations.map(({ version }) => version))].sort(),
);

const client = new pg.Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:55422/' + database,
});
await client.connect();
try {
  await client.query(`
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(
      version text primary key, name text, statements text[]
    );
    insert into supabase_migrations.schema_migrations(version) values ('20261031182953');
    with fixture_group as (
      insert into garments_erp.bucket_group("group") values ('billing-release-rehearsal') returning id
    )
    insert into garments_erp.app_file_route(target_key,bucket_group_id,allowed_mime_types,max_bytes)
    select 'employeePhoto',id,array['image/jpeg','image/png','image/webp'],10485760 from fixture_group
  `);
  const forcedFailure = {
    ...migrations.at(-1),
    sql: "begin; select current_setting('billing_release.forced_test_failure'); commit;",
  };
  await assert.rejects(
    applyRelease(client, [...migrations.slice(0, -1), forcedFailure]),
    /billing_release.forced_test_failure/,
  );
  const rollback = await client.query(`
    select not exists (select 1 from information_schema.columns where table_schema='garments_erp'
      and table_name='billing' and column_name='formal_po_id')
      and exists (select 1 from information_schema.columns where table_schema='garments_erp'
      and table_name='transport_docket' and column_name='transport_number_id')
      and (select count(*)=1 from supabase_migrations.schema_migrations) as valid
  `);
  assert.equal(rollback.rows[0].valid, true);
  console.log(
    'PASS release transaction rolls back Billing schema and history after a late failure',
  );

  await applyRelease(client, migrations);
  await applyRelease(client, migrations);
  console.log(
    'PASS release runner applies and verifies Billing migrations and skips an exact replay',
  );
  await client.query(`
    delete from garments_erp.app_file_route where target_key='employeePhoto'
      and bucket_group_id in (select id from garments_erp.bucket_group where "group"='billing-release-rehearsal');
    delete from garments_erp.bucket_group where "group"='billing-release-rehearsal'
  `);
} finally {
  await client.end();
}
