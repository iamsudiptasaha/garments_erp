import pg from 'pg';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { employeeDraft } from '../src/hr/model.js';
import '../../scripts/ci/assert-test-db.mjs';
const admin = '00000000-0000-4000-8000-000000000001',
  viewer = '00000000-0000-4000-8000-000000000002';
const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await c.connect();
async function actor(id, aal = 'aal2', fresh = true, db = c) {
  await db.query('set local role authenticated');
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [
      id,
      JSON.stringify({
        sub: id,
        aal,
        session_id: id.replace(/^00000000/, '10000000'),
        amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - (fresh ? 0 : 300) }],
      }),
    ],
  );
}
async function snapshot() {
  return (await c.query('select public.erp_employee_snapshot() result')).rows[0].result;
}
async function save(payload, proof = null, db = c) {
  return (
    await db.query('select public.erp_save_employee($1::jsonb,$2::uuid) result', [
      JSON.stringify(payload),
      proof,
    ])
  ).rows[0].result;
}
async function deny(fn, label) {
  await c.query('savepoint denied');
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
    await c.query('rollback to savepoint denied');
  }
  assert.ok(rejected, label);
  await c.query('release savepoint denied');
}
try {
  await c.query('begin');
  await actor(admin);
  const before = await snapshot();
  assert.equal(before.records.length, 2);
  assert.equal(typeof before.records[0].employee.id, 'string');
  const draft = employeeDraft();
  draft.employee.contacts_id = '900002';
  draft.employee.contact_purpose_id = '900001';
  draft.employee.supporting_document_1_title = 'Synthetic HR fixture';
  const payload = { id: null, expected: null, draft };
  await actor(viewer);
  await deny(() => snapshot(), 'viewer cannot read HR');
  await deny(() => save(payload), 'viewer cannot write HR');
  await actor(viewer, 'aal1', false);
  await deny(
    () =>
      c.query('select public.erp_employee_attestation($1,900002,$2)', [
        admin,
        JSON.stringify(payload),
      ]),
    'stale password cannot attest',
  );
  await actor(viewer, 'aal1');
  await deny(
    () =>
      c.query('select public.erp_employee_attestation($1,900001,$2)', [
        admin,
        JSON.stringify(payload),
      ]),
    'cannot impersonate another employee',
  );
  const proof = (
    await c.query('select public.erp_employee_attestation($1,900002,$2) proof', [
      admin,
      JSON.stringify(payload),
    ])
  ).rows[0].proof;
  await actor(admin);
  await deny(
    () =>
      save(
        {
          ...payload,
          draft: { ...draft, employee: { ...draft.employee, contacts_id: '900001' } },
        },
        proof,
      ),
    'proof bound to exact data',
  );
  const saved = await save(payload, proof),
    record = saved.records.find(
      (r) => !before.records.some((b) => b.employee.id === r.employee.id),
    );
  assert.match(record.employee.employee_code, /^SCE\/\d{5}$/);
  assert.equal(record.employee.verified_by_employee_id, '900002');
  assert.equal(record.employee.contacts_id, '900002');
  assert.equal(record.banks, undefined);
  assert.deepEqual(
    (await snapshot()).contact_choices,
    before.contact_choices,
    'Employee saves must not change Contacts',
  );
  await c.query('savepoint upload_change');
  await c.query('reset role');
  await c.query('update garments_erp.employee set supporting_document_1_title=$1 where id=$2', [
    'Changed document',
    record.employee.id,
  ]);
  assert.equal(
    (
      await c.query('select verified_by_employee_id from garments_erp.employee where id=$1', [
        record.employee.id,
      ])
    ).rows[0].verified_by_employee_id,
    null,
  );
  await c.query('rollback to savepoint upload_change');
  await deny(() => save(payload, proof), 'proof is single use');
  const edit = { id: record.employee.id, expected: record.revision, draft: employeeDraft(record) };
  edit.draft.employee.supporting_document_1_title = 'changed';
  await save(edit);
  await deny(() => save(edit), 'stale edit blocked');
  const fresh = (await snapshot()).records.find((r) => r.employee.id === record.employee.id);
  const forged = { id: fresh.employee.id, expected: fresh.revision, draft: employeeDraft(fresh) };
  forged.draft.employee.verified_by_employee_id = '900001';
  await deny(() => save(forged), 'cannot forge verification field');
  const cross = { id: fresh.employee.id, expected: fresh.revision, draft: employeeDraft(fresh) };
  cross.draft.contact = { company_name: 'Forbidden contact edit' };
  await deny(() => save(cross), 'nested contact write blocked');
  const invalid = structuredClone(payload);
  invalid.draft.employee.gender_id = '999999999';
  await deny(() => save(invalid), 'invalid foreign key rolls whole document back');
  assert.equal((await snapshot()).records.length, 3);
  await actor(admin, 'aal1');
  await deny(() => snapshot(), 'operator needs MFA');
  await c.query('rollback');
  console.log(
    'PASS HR role/MFA denial, identity binding, link-only saves, generated code, single-use exact-data proof, stale update and contact-write rejection',
  );
  const a = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL }),
    b = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await a.connect();
  await b.connect();
  try {
    await a.query('begin');
    await b.query('begin');
    await actor(admin, 'aal2', true, a);
    await actor(admin, 'aal2', true, b);
    const original = (await a.query('select public.erp_employee_snapshot() result')).rows[0].result
      .records[0];
    const update = {
      id: original.employee.id,
      expected: original.revision,
      draft: employeeDraft(original),
    };
    update.draft.employee.supporting_document_1_title = 'Synthetic concurrent edit ' + randomUUID();
    await save(update, null, a);
    const second = save(update, null, b).then(
      () => null,
      (e) => e.code,
    );
    await a.query('commit');
    assert.equal(await second, '40001');
    await b.query('rollback');
    console.log('PASS real concurrent Employee saves reject the second stale document');
  } finally {
    await a.end();
    await b.end();
  }
} finally {
  await c.end();
}
