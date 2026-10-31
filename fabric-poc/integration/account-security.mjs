import pg from 'pg';
import assert from 'node:assert/strict';
import '../../scripts/ci/assert-test-db.mjs';
const admin = '00000000-0000-4000-8000-000000000001',
  viewer = '00000000-0000-4000-8000-000000000002';
const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await c.connect();
async function claims(aal = 'aal2', id = admin, session = id.replace(/^00000000/, '10000000')) {
  await c.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [id, JSON.stringify({ sub: id, aal, session_id: session })],
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
  // Wrong attempts persist because invalid credentials return null, never roll back the counter.
  await c.query('begin');
  await c.query('set local role service_role');
  await c.query('select public.erp_issue_recovery($1,$2,$3)', [viewer, 'right-digest', admin]);
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await c.query('select public.erp_consume_recovery($1,$2) id', ['+919000000002', 'wrong']))
        .rows[0].id,
      null,
    );
  // Fixtures have no phone by default: set a synthetic identity inside this rollback transaction.
  await c.query('reset role');
  await c.query("update auth.users set phone='919000000002' where id=$1", [viewer]);
  await c.query('set local role service_role');
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await c.query('select public.erp_consume_recovery($1,$2) id', ['+919000000002', 'wrong']))
        .rows[0].id,
      null,
    );
  assert.equal(
    (
      await c.query('select public.erp_consume_recovery($1,$2) id', [
        '+919000000002',
        'right-digest',
      ])
    ).rows[0].id,
    null,
  );
  await c.query('rollback');
  await c.query('begin');
  await c.query("update auth.users set phone='919000000002' where id=$1", [viewer]);
  await c.query('set local role service_role');
  await c.query('select public.erp_issue_recovery($1,$2,$3)', [viewer, 'right-digest', admin]);
  assert.equal(
    (
      await c.query('select public.erp_consume_recovery($1,$2) id', [
        '+919000000002',
        'right-digest',
      ])
    ).rows[0].id,
    viewer,
  );
  assert.equal(
    (
      await c.query('select public.erp_consume_recovery($1,$2) id', [
        '+919000000002',
        'right-digest',
      ])
    ).rows[0].id,
    null,
  );
  await c.query('reset role');
  assert.equal(
    (await c.query('select count(*) n from auth.sessions where user_id=$1', [viewer])).rows[0].n,
    '0',
  );
  assert.equal(
    (
      await c.query(
        'select must_change_password flag from garments_access.app_user where user_id=$1',
        [viewer],
      )
    ).rows[0].flag,
    true,
  );
  await c.query('rollback');
  await c.query('begin');
  await c.query('set local role authenticated');
  await claims();
  await assert.rejects(
    c.query("select public.erp_account_internal('complete',$1)", [admin]),
    (e) => e.code === '42501',
  );
  await c.query('rollback');
  await c.query('begin');
  await c.query("update auth.users set phone='919000000002' where id=$1", [viewer]);
  await c.query('set local role service_role');
  await c.query('select public.erp_issue_recovery($1,$2,$3)', [viewer, 'expired-digest', admin]);
  await c.query('reset role');
  await c.query(
    "update garments_access.account_recovery set expires_at=now()-interval '1 second' where user_id=$1",
    [viewer],
  );
  await c.query('set local role service_role');
  assert.equal(
    (
      await c.query('select public.erp_consume_recovery($1,$2) id', [
        '+919000000002',
        'expired-digest',
      ])
    ).rows[0].id,
    null,
  );
  await c.query('rollback');
  // Two independent connections compete for one credential; only one may consume it.
  await c.query("update auth.users set phone='919000000002' where id=$1", [viewer]);
  await c.query('begin');
  await c.query('set local role service_role');
  await c.query('select public.erp_issue_recovery($1,$2,$3)', [viewer, 'concurrent-digest', admin]);
  await c.query('commit');
  async function consume() {
    const connection = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await connection.connect();
    try {
      await connection.query('begin');
      await connection.query('set local role service_role');
      const r = await connection.query('select public.erp_consume_recovery($1,$2) id', [
        '+919000000002',
        'concurrent-digest',
      ]);
      await connection.query('commit');
      return r.rows[0].id;
    } finally {
      await connection.end();
    }
  }
  const competing = await Promise.all([consume(), consume()]);
  assert.equal(competing.filter(Boolean).length, 1);
  await c.query('delete from garments_access.account_recovery where user_id=$1', [viewer]);
  await c.query('update garments_access.app_user set must_change_password=false where user_id=$1', [
    viewer,
  ]);
  await c.query('update auth.users set phone=null where id=$1', [viewer]);
  await c.query(
    "insert into auth.sessions(id,user_id,aal) values ('10000000-0000-4000-8000-000000000002',$1,'aal2')",
    [viewer],
  );
  console.log(
    'PASS MFA enforcement, forced-password boundary, invalid session denial, recovery attempt limit/single use/session revocation and service-only reset APIs',
  );
} finally {
  await c.query('rollback');
  await c.end();
}
