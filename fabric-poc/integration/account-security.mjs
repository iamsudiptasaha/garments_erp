import pg from 'pg';
import assert from 'node:assert/strict';
import '../../scripts/ci/assert-test-db.mjs';
const admin = '00000000-0000-4000-8000-000000000001';
const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await c.connect();
async function claims(aal = 'aal2', id = admin, session = id.replace(/^00000000/, '10000000')) {
  await c.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [id, JSON.stringify({ sub: id, aal, amr: [{ method: 'password' }], session_id: session })],
  );
}
try {
  await c.query('begin');
  await c.query('set local role authenticated');
  await claims('aal1');
  assert.equal(
    (await c.query("select (public.erp_account_security()->>'ready')::boolean ok")).rows[0].ok,
    false,
  );
  await assert.rejects(c.query('select public.erp_admin_snapshot()'), (e) => e.code === '42501');
  await c.query('rollback');
  await c.query('begin');
  await c.query('set local role authenticated');
  await claims();
  assert.equal(
    (await c.query("select (public.erp_account_security()->>'ready')::boolean ok")).rows[0].ok,
    true,
  );
  await c.query('reset role');
  await c.query('update garments_access.app_user set must_change_password=true where user_id=$1', [
    admin,
  ]);
  await c.query('set local role authenticated');
  assert.equal(
    (await c.query("select (public.erp_account_security()->>'ready')::boolean ok")).rows[0].ok,
    false,
  );
  await c.query('rollback');
  await c.query('begin');
  await c.query('set local role authenticated');
  await claims('aal2', admin, '90000000-0000-4000-8000-000000000001');
  assert.equal(
    (await c.query("select (public.erp_account_security()->>'ready')::boolean ok")).rows[0].ok,
    false,
  );
  await c.query('rollback');
  // Removing the last verified factor must invalidate access even with a stale AAL2 JWT.
  await c.query('begin');
  await c.query('delete from auth.mfa_factors where user_id=$1', [admin]);
  await c.query('set local role authenticated');
  await claims();
  assert.equal(
    (await c.query("select (public.erp_account_security()->>'ready')::boolean ok")).rows[0].ok,
    false,
  );
  await c.query('rollback');
  await c.query('begin');
  const pending = '00000000-0000-4000-8000-000000000002';
  const role = (await c.query("select id from garments_access.app_role where key='ci_admin'"))
    .rows[0].id;
  await c.query('insert into garments_access.app_user_role(user_id,role_id) values($1,$2)', [
    pending,
    role,
  ]);
  await c.query('update garments_access.app_user set must_change_password=true where user_id=$1', [
    pending,
  ]);
  const account = (
    await c.query('select employee_id,version from garments_access.app_user where user_id=$1', [
      admin,
    ])
  ).rows[0];
  await c.query('set local role authenticated');
  await claims();
  await assert.rejects(
    c.query('select public.erp_save_account_access($1,$2,$3,false,$4)', [
      admin,
      account.employee_id,
      [role],
      account.version,
    ]),
    /Keep at least one active Administrator with completed setup/,
  );
  await c.query('rollback');
  const retired = await c.query(
    "select to_regprocedure('public.erp_consume_recovery(text,text)') as consume, to_regprocedure('public.erp_issue_recovery(uuid,text,uuid)') as issue",
  );
  assert.deepEqual(retired.rows[0], { consume: null, issue: null });
  await c.query('begin');
  await c.query('update garments_access.app_user set is_active=false where user_id=$1', [admin]);
  await assert.rejects(
    c.query("update auth.users set encrypted_password='synthetic hash' where id=$1", [admin]),
    (error) => error.code === '42501',
  );
  await c.query('rollback');
  console.log(
    'PASS SQL account guards, verified TOTP, retired recovery RPCs and disabled-account password write denial',
  );
} finally {
  await c.end();
}
