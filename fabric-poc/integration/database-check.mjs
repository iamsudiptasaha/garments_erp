import pg from 'pg';
import { randomUUID } from 'node:crypto';
import '../../scripts/ci/assert-test-db.mjs';
const { Client } = pg;
const url = process.env.TEST_DATABASE_URL;
const admin = '00000000-0000-4000-8000-000000000001',
  viewer = '00000000-0000-4000-8000-000000000002';
async function connect() {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}
async function actor(c, id) {
  await c.query('set local role authenticated');
  await c.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({
      sub: id,
      aal: 'aal2',
      amr: [{ method: 'password' }],
      session_id: id.replace(/^00000000/, '10000000'),
    }),
  ]);
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
}
async function rpc(c, resource, root, action, changes) {
  return (
    await c.query('select public.erp_save_fabric_document($1,$2::jsonb,$3,$4::jsonb) result', [
      resource,
      JSON.stringify(root),
      action,
      JSON.stringify(changes),
    ])
  ).rows[0].result;
}
function assert(value, message) {
  if (!value) throw Error(message);
}
async function denied(c, fn, label, code) {
  await c.query('savepoint denial');
  let rejected = false;
  try {
    await fn();
  } catch (e) {
    rejected = true;
    if (code && e.code !== code)
      throw Error(`${label}: unexpected error class ${e.code}`, { cause: e });
  }
  await c.query('rollback to savepoint denial');
  assert(rejected, label + ' was incorrectly allowed');
}
const c = await connect();
let row;
try {
  await c.query('begin');
  await denied(
    c,
    () => c.query('select public.erp_fabric_snapshot()'),
    'Anonymous RPC read',
    '42501',
  );
  await actor(c, viewer);
  await denied(
    c,
    () => c.query('select * from garments_erp.color_map'),
    'Direct table read',
    '42501',
  );
  const temp = randomUUID(),
    root = { table: 'color_map', id: temp, before: null },
    change = {
      table: 'color_map',
      id: temp,
      before: null,
      values: { name: 'Synthetic atomic fixture', pantone_code: null },
    };
  await denied(c, () => rpc(c, 'colours', root, 'create', [change]), 'Viewer create', '42501');
  await actor(c, admin);
  const snapshot = await rpc(c, 'colours', root, 'create', [change]);
  row = snapshot.color_map.find((r) => r.name === 'Synthetic atomic fixture');
  assert(row && typeof row.id === 'string', 'Created row and bigint string identity');
  const existing = { table: 'color_map', id: row.id, before: row },
    edit = {
      table: 'color_map',
      id: row.id,
      before: row,
      values: { name: 'Synthetic edited fixture', pantone_code: null },
    };
  await denied(
    c,
    () => rpc(c, 'colours', { ...existing, before: { ...row, name: 'stale' } }, 'edit', [edit]),
    'Stale edit',
    '40001',
  );
  await denied(
    c,
    () =>
      rpc(c, 'colours', existing, 'edit', [
        edit,
        {
          table: 'contacts',
          id: randomUUID(),
          before: null,
          values: { company_name: 'must roll back' },
        },
      ]),
    'Out-of-contract multi-row command',
  );
  assert(
    (await c.query('select public.erp_fabric_snapshot() result')).rows[0].result.color_map.find(
      (r) => r.id === row.id,
    ).name === row.name,
    'Failed multi-row command rolled back earlier writes',
  );
  await denied(
    c,
    () => rpc(c, 'colours', existing, 'edit', [{ ...edit, values: null }]),
    'Root deletion',
  );
  const edited = await rpc(c, 'colours', existing, 'edit', [edit]);
  assert(
    edited.color_map.find((r) => r.id === row.id).name === edit.values.name,
    'Valid authenticated edit',
  );
  const audit = (await c.query('select public.erp_admin_snapshot() result')).rows[0].result.audit;
  assert(
    audit.filter(
      (r) =>
        r.target_type === 'color_map' &&
        r.target_id === row.id &&
        Object.hasOwn(r.details, 'changed_rows'),
    ).length === 2,
    'Successful create/edit audit events recorded',
  );
  await c.query('rollback');
  console.log(
    'PASS anonymous/viewer/direct-access denial, bigint identity, valid write, stale edit and atomic rollback',
  );
  const invalid = await c.query(
    "select count(*)::int n from pg_constraint where connamespace in ('garments_erp'::regnamespace,'garments_access'::regnamespace) and not convalidated",
  );
  assert(invalid.rows[0].n === 0, 'Unvalidated database constraints');
  await deniedInTransaction(
    async () => {
      await c.query(
        "insert into garments_erp.brand_list(contacts_id,contact_purpose_id,brand) values (-999,-999,'invalid FK')",
      );
    },
    'Foreign key enforcement',
    '23503',
  );
  const a = await connect(),
    b = await connect();
  try {
    await a.query('begin');
    await actor(a, admin);
    const id = randomUUID(),
      saved = await rpc(a, 'colours', { table: 'color_map', id, before: null }, 'create', [
        { table: 'color_map', id, before: null, values: { name: 'Synthetic concurrency fixture' } },
      ]);
    const current = saved.color_map.find((r) => r.name === 'Synthetic concurrency fixture');
    await a.query('commit');
    await a.query('begin');
    await actor(a, admin);
    await a.query('select pg_advisory_xact_lock(741208531)');
    await b.query('begin');
    await actor(b, admin);
    await b.query("set local lock_timeout='100ms'");
    let timedOut = false;
    try {
      await rpc(b, 'colours', { table: 'color_map', id: current.id, before: current }, 'edit', [
        { table: 'color_map', id: current.id, before: current, values: { name: 'Must not race' } },
      ]);
    } catch (e) {
      timedOut = e.code === '55P03';
    }
    assert(timedOut, 'Concurrent write did not honor transaction lock');
    await b.query('rollback');
    await a.query('rollback');
    await c.query('delete from garments_erp.color_map where id=$1', [current.id]);
    console.log('PASS real concurrent sessions honor the document write lock');
  } finally {
    await a.end();
    await b.end();
  }
  const exposure = await c.query(
    "select n.nspname||'.'||r.relname name from pg_class r join pg_namespace n on n.oid=r.relnamespace where n.nspname in ('garments_erp','garments_access') and r.relkind='r' and (not r.relrowsecurity or has_table_privilege('anon',r.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',r.oid,'SELECT,INSERT,UPDATE,DELETE'))",
  );
  assert(exposure.rows.length === 0, 'Unprotected application tables detected');
  console.log('PASS RLS/default-deny posture and validated constraints');
} finally {
  await c.end();
}
async function deniedInTransaction(fn, label, code) {
  await c.query('begin');
  try {
    await denied(c, fn, label, code);
  } finally {
    await c.query('rollback');
  }
}
