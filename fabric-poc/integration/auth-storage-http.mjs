import { readFileSync } from 'node:fs';
import { randomBytes, createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import assert from 'node:assert/strict';
import '../../scripts/ci/assert-test-db.mjs';
import { credentialDigest } from '../../supabase/functions/erp-accounts/service.mjs';
const settings = JSON.parse(
  readFileSync(process.env.TEST_RUNTIME_FILE || '/tmp/erp-test-runtime.json', 'utf8'),
);
if (settings.API_URL !== 'http://127.0.0.1:55421')
  throw Error('Only the isolated local API is allowed');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, options);
const user = createClient(settings.API_URL, settings.ANON_KEY, options);
const anon = createClient(settings.API_URL, settings.ANON_KEY, options);
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
let uid, attachment, path, bucket, createdEmployeeAuth;
function ok(result, label) {
  if (result.error) throw Error(label + ' failed: ' + result.error.message);
  return result.data;
}
function totp(secret) {
  let bits = '';
  for (const ch of secret.toUpperCase().replace(/=+$/, ''))
    bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch).toString(2).padStart(5, '0');
  const raw = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) raw.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', Buffer.from(raw)).update(counter).digest();
  const i = hash[19] & 15;
  return String((hash.readUInt32BE(i) & 0x7fffffff) % 1000000).padStart(6, '0');
}
try {
  const password = randomBytes(24).toString('hex');
  const signup = await anon.auth.signUp({
    email: 'public-signup-' + randomBytes(8).toString('hex') + '@example.invalid',
    password,
  });
  if (signup.data?.user) await admin.auth.admin.deleteUser(signup.data.user.id);
  assert.ok(signup.error, 'Public signup must be disabled');
  const created = ok(
    await admin.auth.admin.createUser({
      email: 'http-ci-' + randomBytes(8).toString('hex') + '@example.invalid',
      password,
      email_confirm: true,
    }),
    'Create synthetic Auth identity',
  );
  uid = created.user.id;
  await db.query(
    "insert into garments_erp.contacts(id,company_name) values(900003,'Synthetic HTTP account')",
  );
  await db.query(
    "insert into garments_erp.employee(id,employee_code,contacts_id,contact_purpose_id) values(900003,'SCE/90003',900003,900001)",
  );
  await db.query(
    'insert into garments_access.app_user(user_id,employee_id,is_active) values($1,900003,true)',
    [uid],
  );
  await db.query(
    "insert into garments_access.app_user_role(user_id,role_id) select $1,id from garments_access.app_role where key='ci_admin'",
    [uid],
  );
  ok(
    await user.auth.signInWithPassword({ email: created.user.email, password }),
    'Password sign in',
  );
  assert.equal(ok(await user.rpc('erp_account_security'), 'AAL1 security').ready, false);
  assert.ok(
    (await user.rpc('erp_admin_snapshot')).error,
    'Password alone must not expose Administration',
  );
  const factor = ok(
    await user.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Synthetic integration' }),
    'TOTP enrollment',
  );
  ok(
    await user.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(factor.totp.secret) }),
    'Actual TOTP verification',
  );
  assert.equal(ok(await user.rpc('erp_account_security'), 'AAL2 security').ready, true);
  ok(await user.rpc('erp_admin_snapshot'), 'MFA administrator read');
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=',
    'base64',
  );
  const ticket = ok(
    await user.rpc('erp_begin_file_upload', {
      p_key: 'yarnBill',
      p_record_id: '900001',
      p_filename: 'synthetic.png',
      p_mime: 'image/png',
      p_size: bytes.length,
    }),
    'Reserve file',
  );
  path = ticket.storage_path;
  bucket = ticket.bucket_id;
  ok(
    await admin.storage
      .from(bucket)
      .upload(path, bytes, { contentType: 'image/png', upsert: false }),
    'Upload private object',
  );
  const saved = ok(
    await user.rpc('erp_finish_file_upload', { p_ticket: ticket.id }),
    'Atomic attachment finalisation',
  );
  attachment = saved.id;
  assert.equal(typeof attachment, 'string');
  const read = ok(await user.rpc('erp_file_read', { p_id: attachment }), 'Authorized file read');
  const signed = ok(
    await admin.storage.from(read.bucket_id).createSignedUrl(read.storage_path, 60),
    'Private read link',
  );
  const response = await fetch(signed.signedUrl);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.ok(
    (await anon.storage.from(bucket).download(path)).error,
    'Anonymous object access denied',
  );
  if (process.env.TEST_ACCOUNTS_SERVICE === '1') {
    const session = ok(await user.auth.getSession(), 'Get test session').session;
    async function command(body) {
      return fetch('http://127.0.0.1:55425', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token,
        },
        body: JSON.stringify(body),
      });
    }
    const snap = ok(await user.rpc('erp_admin_snapshot'), 'Admin provisioning catalogue');
    const role = snap.roles.find((r) => r.key === 'ci_viewer');
    await db.query(
      "insert into garments_erp.contacts(id,company_name) values(900004,'Synthetic employee setup')",
    );
    await db.query(
      "insert into garments_erp.employee(id,employee_code,contacts_id,contact_purpose_id) values(900004,'SCE/90004',900004,900001)",
    );
    assert.equal(
      (
        await command({
          action: 'create',
          employeeId: '900004',
          phone: '9000000004',
          roleIds: [String(role.id)],
          enabled: true,
        })
      ).status,
      200,
    );
    const employee = (
      await db.query(
        'select user_id,must_change_password from garments_access.app_user where employee_id=900004',
      )
    ).rows[0];
    createdEmployeeAuth = employee.user_id;
    assert.equal(employee.must_change_password, true);
    assert.equal(
      (await command({ action: 'issueRecovery', userId: createdEmployeeAuth })).status,
      400,
      'No configured SMTP must never pretend delivery succeeded',
    );
    assert.equal(
      (
        await db.query(
          'select count(*) n from garments_access.account_recovery where user_id=$1 and used_at is null',
          [createdEmployeeAuth],
        )
      ).rows[0].n,
      '0',
    );
    // Local fixture replaces the delivery step only; the actual handler consumes the persisted credential.
    const code = 'B'.repeat(32),
      digest = await credentialDigest(code, 'synthetic-integration-pepper-never-for-production');
    await db.query('delete from garments_access.account_recovery where user_id=$1', [
      createdEmployeeAuth,
    ]);
    ok(
      await admin.rpc('erp_issue_recovery', {
        p_user_id: createdEmployeeAuth,
        p_digest: digest,
        p_actor: uid,
      }),
      'Reserve synthetic recovery',
    );
    const resetPassword = randomBytes(24).toString('hex');
    const reset = await fetch('http://127.0.0.1:55425', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'recover',
        phone: '9000000004',
        code,
        password: resetPassword,
      }),
    });
    assert.equal(reset.status, 200);
    const fresh = createClient(settings.API_URL, settings.ANON_KEY, options);
    ok(
      await fresh.auth.signInWithPassword({ phone: '+919000000004', password: resetPassword }),
      'Sign in with reset password',
    );
    assert.equal(
      ok(await fresh.rpc('erp_account_security'), 'Require enrollment after recovery').ready,
      false,
    );
    assert.equal(
      (
        await fetch('http://127.0.0.1:55425', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'recover',
            phone: '9000000004',
            code,
            password: resetPassword,
          }),
        })
      ).status,
      400,
      'Consumed code cannot replay',
    );
    assert.equal(
      (
        await command({
          action: 'changePassword',
          currentPassword: 'incorrect',
          password: resetPassword,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await command({
          action: 'changePassword',
          currentPassword: password,
          password: resetPassword,
        })
      ).status,
      200,
    );
    const changed = createClient(settings.API_URL, settings.ANON_KEY, options);
    ok(
      await changed.auth.signInWithPassword({ email: created.user.email, password: resetPassword }),
      'Updated password works',
    );
    console.log(
      'PASS actual account handler: create/link, forced setup, failed SMTP invalidation, password reset, replay denial and current-password verification',
    );
  }
  await db.query('delete from auth.sessions where user_id=$1', [uid]);
  assert.equal(ok(await user.rpc('erp_account_security'), 'Revoked session check').ready, false);
  assert.ok(
    (await user.rpc('erp_file_read', { p_id: attachment })).error,
    'Revoked session cannot obtain new file URLs',
  );
  console.log(
    'PASS real local Auth password/TOTP/AAL2, private Storage upload/finalisation/signed download, anonymous denial and revoked-session denial',
  );
} finally {
  if (bucket && path) await admin.storage.from(bucket).remove([path]);
  if (createdEmployeeAuth) {
    await db.query('delete from garments_access.account_recovery where user_id=$1', [
      createdEmployeeAuth,
    ]);
    await db.query('delete from garments_access.app_activity_log where target_id=$1', [
      createdEmployeeAuth,
    ]);
    await db.query('delete from garments_access.app_user_role where user_id=$1', [
      createdEmployeeAuth,
    ]);
    await db.query('delete from garments_access.app_user where user_id=$1', [createdEmployeeAuth]);
    await admin.auth.admin.deleteUser(createdEmployeeAuth);
  }
  await db.query('delete from garments_erp.employee where id=900004');
  await db.query('delete from garments_erp.contacts where id=900004');
  if (uid) {
    await db.query('update garments_erp.yarn_bill set bill_attachment=null where id=900001');
    await db.query('delete from garments_access.app_file_upload where created_by=$1', [uid]);
    if (attachment)
      await db.query('delete from garments_erp.attachments where id=$1', [attachment]);
    await db.query('delete from garments_access.app_activity_log where actor_user_id=$1', [uid]);
    await db.query('delete from garments_access.app_user_role where user_id=$1', [uid]);
    await db.query('delete from garments_access.app_user where user_id=$1', [uid]);
    await db.query('delete from garments_erp.employee where id=900003');
    await db.query('delete from garments_erp.contacts where id=900003');
    await admin.auth.admin.deleteUser(uid);
  }
  await db.end();
}
