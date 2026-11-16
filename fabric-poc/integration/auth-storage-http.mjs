import { readFileSync } from 'node:fs';
import { randomBytes, createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { employeeDraft } from '../src/hr/model.js';
import assert from 'node:assert/strict';
import '../../scripts/ci/assert-test-db.mjs';
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
let uid, attachment, path, bucket, createdEmployeeAuth, createdEmployeeId, createdRole;
const retiredInvitations = [];
let retiredAuthId;
let employeePhoto, employeePhotoTicket;
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
    async function command(body, token = session.access_token) {
      return fetch('http://127.0.0.1:55425', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
      });
    }
    async function capturedEmail(address, pattern, previous = null) {
      for (let attempt = 0; attempt < 25; attempt++) {
        const inbox = await (await fetch('http://127.0.0.1:55424/api/v1/messages')).json();
        for (const message of inbox.messages.filter((m) =>
          m.To.some((to) => to.Address === address),
        )) {
          const delivered = await (
            await fetch('http://127.0.0.1:55424/api/v1/message/' + message.ID)
          ).json();
          const match = delivered.HTML.match(pattern);
          if (match && match[1] !== previous) return match[1];
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw Error('Expected message did not arrive in the local capture inbox');
    }
    function emailToken(address, type, previous) {
      return capturedEmail(
        address,
        new RegExp('type=' + type + '&(?:amp;)?token_hash=([^"\\s<]+)'),
        previous,
      );
    }
    let createdEmployeeEmail = 'provisioned-' + randomBytes(8).toString('hex') + '@example.invalid';
    const snap = ok(await user.rpc('erp_admin_snapshot'), 'Admin provisioning catalogue');
    const role = snap.roles.find((r) => r.key === 'ci_viewer');
    await db.query(
      "insert into garments_erp.contacts(id,company_name) values(900004,'Synthetic employee setup')",
    );
    const draft = employeeDraft();
    draft.employee.contacts_id = '900004';
    draft.employee.contact_purpose_id = '900001';
    const registered = ok(
      await user.rpc('erp_save_employee', {
        p_payload: { id: null, expected: null, draft },
        p_proof: null,
      }),
      'Register employee with no email',
    );
    const { employee: employeeRecord, status: employeeStatus } = registered.records.find(
      (r) => r.employee.contacts_id === '900004',
    );
    createdEmployeeId = employeeRecord.id;
    assert.match(createdEmployeeId, /^\d+$/);
    assert.match(employeeRecord.employee_code, /^SCE-\d{5}$/);
    assert.equal(employeeRecord.employee_status_id, employeeStatus.id);
    assert.equal(employeeStatus.verified_by_employee_id, '900003');
    const invite = {
      action: 'invite',
      employeeId: createdEmployeeId,
      email: createdEmployeeEmail,
      roleIds: [String(role.id)],
    };
    const low = createClient(settings.API_URL, settings.ANON_KEY, options);
    const lowSession = ok(
      await low.auth.signInWithPassword({ email: created.user.email, password }),
      'AAL1 administrator',
    ).session;
    assert.equal((await command(invite, lowSession.access_token)).status, 400);
    assert.ok(
      (
        await low.rpc('erp_employee_invitation', {
          p_action: 'invite',
          p_employee_id: createdEmployeeId,
          p_email: createdEmployeeEmail,
          p_role_ids: [role.id],
        })
      ).error,
      'AAL1 cannot reserve invitations directly',
    );
    const reserve = ok(
      await user.rpc('erp_employee_invitation', {
        p_action: 'invite',
        p_employee_id: createdEmployeeId,
        p_email: createdEmployeeEmail,
        p_role_ids: [role.id],
      }),
      'Reserve before native Auth call',
    );
    const cancel = { action: 'cancel', employeeId: createdEmployeeId, revision: reserve.revision };
    assert.equal((await command(cancel, lowSession.access_token)).status, 400);
    assert.equal((await command(cancel)).status, 200, 'Cancel pending invitation');
    retiredInvitations.push(reserve.nonce);
    assert.ok(
      (
        await admin.auth.admin.inviteUserByEmail(createdEmployeeEmail, {
          data: { erp_invitation: reserve.nonce },
        })
      ).error,
      'A delayed native invite cannot bind a cancelled nonce',
    );
    assert.equal(
      (
        await command({
          action: 'retry',
          employeeId: createdEmployeeId,
          revision: reserve.revision,
        })
      ).status,
      400,
    );
    await db.query(
      `alter table garments_access.app_user add constraint test_interrupted_invite check (employee_id <> ${createdEmployeeId})`,
    );
    try {
      assert.equal((await command(invite)).status, 400, 'Auth sent email but ERP link failed');
      const original = (
        await db.query(
          'select revision,nonce,user_id from garments_access.employee_invitation where employee_id=$1',
          [createdEmployeeId],
        )
      ).rows[0];
      const correction = {
        action: 'correct',
        employeeId: createdEmployeeId,
        revision: original.revision,
      };
      assert.equal(
        (await command({ ...correction, email: created.user.email })).status,
        400,
        'Duplicate destination leaves the original pending',
      );
      assert.equal(
        (await command(cancel)).status,
        400,
        'Stale confirmation cannot cancel a replacement',
      );
      const oldEmail = createdEmployeeEmail;
      const oldHash = await emailToken(oldEmail, 'invite');
      createdEmployeeEmail = 'corrected-' + randomBytes(8).toString('hex') + '@example.invalid';
      assert.equal(
        (await command({ ...correction, email: createdEmployeeEmail })).status,
        400,
        'Correction commits before the replacement links, so an interruption remains retryable',
      );
      retiredInvitations.push(original.nonce);
      retiredAuthId = original.user_id;
      const oldLink = createClient(settings.API_URL, settings.ANON_KEY, options);
      const oldResult = await oldLink.auth.verifyOtp({ token_hash: oldHash, type: 'invite' });
      if (!oldResult.error) {
        assert.equal(oldResult.data.user.id, original.user_id);
        assert.equal(
          ok(await oldLink.rpc('erp_account_security'), 'Cancelled identity').enabled,
          false,
        );
      }
      const legacyLink = await user.rpc('erp_save_account_access', {
        p_user_id: original.user_id,
        p_employee_id: createdEmployeeId,
        p_role_ids: [role.id],
        p_enabled: false,
        p_expected_version: null,
      });
      assert.match(legacyLink.error?.message || '', /invitation was cancelled/);
      assert.ok(
        (
          await user.rpc('erp_employee_invitation', {
            p_action: 'finish',
            p_employee_id: createdEmployeeId,
            p_revision: original.revision,
          })
        ).error,
        'Late completion cannot finish a corrected invitation',
      );
      const audit = (
        await db.query(
          "select action,details,actor_user_id from garments_access.app_activity_log where target_type='employee' and target_id=$1 and action in ('Cancelled employee invitation','Corrected employee invitation email') order by id",
          [createdEmployeeId],
        )
      ).rows;
      assert.deepEqual(
        audit.map((entry) => entry.action),
        ['Cancelled employee invitation', 'Corrected employee invitation email'],
      );
      assert.equal(audit[1].details.old_email, oldEmail);
      assert.equal(audit[1].details.new_email, createdEmployeeEmail);
      assert.equal(audit[1].actor_user_id, created.user.id);
    } finally {
      await db.query(
        'alter table garments_access.app_user drop constraint test_interrupted_invite',
      );
    }
    const pending = ok(
      await user.rpc('erp_admin_snapshot'),
      'Pending invite',
    ).pending_invitations.find((item) => String(item.employee_id) === createdEmployeeId);
    assert.deepEqual(pending.role_ids, [role.id]);
    assert.equal(pending.email, createdEmployeeEmail);
    assert.equal(pending.nonce, undefined);
    createdEmployeeAuth = (
      await db.query(
        'select user_id from garments_access.employee_invitation where employee_id=$1',
        [createdEmployeeId],
      )
    ).rows[0].user_id;
    assert.ok(createdEmployeeAuth);
    const firstHash = await emailToken(createdEmployeeEmail, 'invite');
    assert.equal(
      (await command(invite)).status,
      400,
      'Duplicate Invite does not create an account',
    );
    const retry = { action: 'retry', employeeId: createdEmployeeId, revision: pending.revision };
    const retried = await Promise.all([command(retry), command(retry)]);
    assert.deepEqual(
      retried.map((response) => response.status),
      [200, 200],
    );
    const reservation = (
      await db.query(
        'select email, user_id from garments_access.employee_invitation where employee_id=$1',
        [createdEmployeeId],
      )
    ).rows[0];
    assert.deepEqual(
      reservation,
      { email: null, user_id: createdEmployeeAuth },
      'Completed reservation keeps the UUID for retries and releases the email',
    );

    const inbox = await (await fetch('http://127.0.0.1:55424/api/v1/messages')).json();
    assert.equal(
      inbox.messages.filter((m) => m.To.some((to) => to.Address === createdEmployeeEmail)).length,
      1,
    );
    const resend = { action: 'resend', employeeId: createdEmployeeId };
    assert.equal((await command(resend)).status, 400, 'Resend is rate limited');
    await db.query(
      "update garments_access.app_activity_log set created_at=now()-interval '2 minutes' where target_type='employee' and target_id=$1 and action='Requested employee invitation'",
      [createdEmployeeId],
    );
    await db.query(
      "update auth.users set confirmation_sent_at=now()-interval '1 day' where id=$1",
      [createdEmployeeAuth],
    );
    assert.ok(
      (await anon.auth.verifyOtp({ token_hash: firstHash, type: 'invite' })).error,
      'Expired invitation denied',
    );
    assert.equal((await command(resend)).status, 200, 'Resend to existing Auth identity');
    const employee = (
      await db.query(
        'select user_id,must_change_password from garments_access.app_user where employee_id=$1',
        [createdEmployeeId],
      )
    ).rows[0];
    assert.equal(employee.user_id, createdEmployeeAuth, 'Retry and resend preserve Auth UUID');
    assert.equal(employee.must_change_password, true);
    const fresh = createClient(settings.API_URL, settings.ANON_KEY, options);
    const setupHash = await emailToken(createdEmployeeEmail, 'recovery');
    const accepted = ok(
      await fresh.auth.verifyOtp({ token_hash: setupHash, type: 'recovery' }),
      'Accept invitation',
    );
    assert.equal(accepted.user.id, createdEmployeeAuth);
    assert.equal(ok(await fresh.rpc('erp_account_security'), 'Pending invitation').ready, false);
    const initial = randomBytes(24).toString('hex');
    ok(await fresh.auth.updateUser({ password: initial }), 'Set invited password');
    assert.equal(
      ok(await fresh.rpc('erp_account_security'), 'Setup completed').mustChangePassword,
      false,
    );
    assert.ok(
      (await anon.auth.verifyOtp({ token_hash: setupHash, type: 'recovery' })).error,
      'Invite cannot replay',
    );
    ok(
      await fresh.auth.signInWithPassword({ email: createdEmployeeEmail, password: initial }),
      'Email/password login',
    );
    assert.equal(
      ok(await fresh.rpc('erp_account_security'), 'Password login requires TOTP').ready,
      false,
    );
    const employeeFactor = ok(
      await fresh.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Invite integration' }),
      'Invitee TOTP enrollment',
    );
    ok(
      await fresh.auth.mfa.challengeAndVerify({
        factorId: employeeFactor.id,
        code: totp(employeeFactor.totp.secret),
      }),
      'Invitee TOTP verification',
    );
    assert.equal(ok(await fresh.rpc('erp_account_security'), 'Invitee AAL2 access').ready, true);
    const details = { p_name: 'Edited profile fixture', p_phone: '+91 555 123 4567' };
    const profile = ok(await fresh.rpc('erp_my_profile'), 'Own profile');
    assert.equal(profile.employeeId, String(createdEmployeeId));
    await assert.rejects(
      db.query(
        'insert into garments_erp.employee(contacts_id,contact_purpose_id) select contacts_id,contact_purpose_id from garments_erp.employee where id=$1',
        [createdEmployeeId],
      ),
      { code: '23505', constraint: 'employee_primary_contact_unique' },
    );
    assert.equal(profile.email, createdEmployeeEmail);
    assert.ok((await anon.rpc('erp_my_profile')).error, 'Anonymous profile denied');
    assert.ok((await low.rpc('erp_save_my_profile', details)).error, 'AAL1 profile write denied');
    ok(await fresh.rpc('erp_save_my_profile', details), 'Save own Contact fields');
    const changedProfile = ok(await fresh.rpc('erp_my_profile'), 'Read synchronized profile');
    assert.equal(changedProfile.name, details.p_name);
    assert.equal(changedProfile.phone, details.p_phone);
    assert.equal(changedProfile.email, profile.email);
    assert.deepEqual(changedProfile.roles, profile.roles);
    const ownPhoto = {
      p_key: 'employeePhoto',
      p_record_id: profile.employeeId,
      p_filename: 'profile.png',
      p_mime: 'image/png',
      p_size: bytes.length,
    };
    assert.ok(
      (await fresh.rpc('erp_begin_file_upload', { ...ownPhoto, p_record_id: '900003' })).error,
      'Employee cannot upload a photo for another employee',
    );
    assert.ok(
      (await fresh.rpc('erp_begin_file_upload', { ...ownPhoto, p_key: 'employeeDocument1' })).error,
      'Employee photo permission does not grant document writes',
    );
    employeePhotoTicket = ok(
      await fresh.rpc('erp_begin_file_upload', ownPhoto),
      'Reserve own photo',
    );
    ok(
      await admin.storage
        .from(employeePhotoTicket.bucket_id)
        .upload(employeePhotoTicket.storage_path, bytes, {
          contentType: 'image/png',
          upsert: false,
        }),
      'Upload private employee photo',
    );
    employeePhoto = ok(
      await fresh.rpc('erp_finish_file_upload', { p_ticket: employeePhotoTicket.id }),
      'Link own photo',
    ).id;
    assert.equal(ok(await fresh.rpc('erp_my_profile'), 'Profile photo').photo, employeePhoto);
    assert.ok((await low.rpc('erp_file_read', { p_id: employeePhoto })).error, 'AAL1 photo denied');
    ok(await fresh.rpc('erp_file_read', { p_id: employeePhoto }), 'Read own current photo');
    ok(await fresh.rpc('erp_remove_my_photo', { p_expected: employeePhoto }), 'Remove own photo');
    assert.equal(ok(await fresh.rpc('erp_my_profile'), 'Photo removed').photo, null);
    assert.ok(
      (await fresh.rpc('erp_file_read', { p_id: employeePhoto })).error,
      'Removed photo denied',
    );
    console.log(
      'PASS profile Contact synchronization, session scope and private employee photo lifecycle',
    );

    assert.equal(
      (await command(invite, (await fresh.auth.getSession()).data.session.access_token)).status,
      400,
      'Employee cannot invite',
    );
    const updatedEmail = 'changed-' + randomBytes(8).toString('hex') + '@example.invalid';
    async function authorizeEmail(client, email) {
      return client.rpc('erp_authorize_employee_email_change', { p_email: email });
    }
    assert.ok(
      (await authorizeEmail(low, updatedEmail)).error,
      'AAL1 cannot authorize email change',
    );
    assert.ok(
      (await fresh.auth.updateUser({ email: updatedEmail })).error,
      'Auth email change needs ERP authorization',
    );
    ok(await authorizeEmail(fresh, created.user.email), 'Authorize existing address request');
    assert.ok(
      (await fresh.auth.updateUser({ email: created.user.email })).error,
      'Duplicate login email rejected',
    );
    ok(await authorizeEmail(fresh, updatedEmail), 'Authorize new email');
    ok(await fresh.auth.updateUser({ email: updatedEmail }), 'Send native email-change OTP');
    const otpPattern = /<strong>([0-9]{6})<\/strong>/;
    const expiredOtp = await capturedEmail(updatedEmail, otpPattern);
    const proof = createClient(settings.API_URL, settings.ANON_KEY, options);
    async function verifyEmail(token) {
      return proof.auth.verifyOtp({ email: updatedEmail, token, type: 'email_change' });
    }
    assert.equal(
      ok(await fresh.auth.getUser(), 'Pending address').user.email,
      createdEmployeeEmail,
    );
    await db.query(
      "update garments_access.pending_employee_email set expires_at=now()-interval '1 second' where user_id=$1",
      [createdEmployeeAuth],
    );
    assert.ok((await verifyEmail(expiredOtp)).error, 'Expired request rejects the native code');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    ok(await authorizeEmail(fresh, updatedEmail), 'Reauthorize expired request');
    ok(await fresh.auth.updateUser({ email: updatedEmail }), 'Resend a native OTP');
    const emailOtp = await capturedEmail(updatedEmail, otpPattern, expiredOtp);
    assert.ok((await verifyEmail(expiredOtp)).error, 'Resend replaces the earlier code');
    assert.ok(
      (await verifyEmail(emailOtp === '000000' ? '000001' : '000000')).error,
      'Incorrect OTP rejected',
    );
    try {
      await db.query(
        `alter table garments_erp.contact_items add constraint ci_email_sync_failure check (email is null)`,
      );
      assert.ok((await verifyEmail(emailOtp)).error, 'Contact failure rejects Auth update');
      assert.equal(
        ok(await fresh.auth.getUser(), 'Failed change retains old email').user.email,
        createdEmployeeEmail,
      );
      assert.equal(
        (
          await db.query(
            "select count(*) n from garments_access.app_activity_log where action='Changed login email' and actor_user_id=$1",
            [createdEmployeeAuth],
          )
        ).rows[0].n,
        '0',
      );
    } finally {
      await db.query(
        'alter table garments_erp.contact_items drop constraint if exists ci_email_sync_failure',
      );
    }
    ok(await verifyEmail(emailOtp), 'Retry exact native email OTP after rollback');
    assert.ok((await verifyEmail(emailOtp)).error, 'Email-change OTP cannot replay');
    const contact = (
      await db.query(
        'select email,primary_email from garments_erp.contact_items where contact_id=900004 and primary_email',
      )
    ).rows[0];
    assert.deepEqual(contact, { email: updatedEmail, primary_email: true });
    assert.equal(
      (
        await db.query(
          'select phone from garments_erp.contact_items where contact_id=900004 and primary_phone',
        )
      ).rows[0].phone,
      details.p_phone,
    );
    const audited = (
      await db.query(
        "select details from garments_access.app_activity_log where action='Changed login email' and actor_user_id=$1",
        [createdEmployeeAuth],
      )
    ).rows[0].details;
    assert.equal(audited.old_email, createdEmployeeEmail);
    assert.equal(audited.new_email, updatedEmail);
    assert.ok(audited.completed_at);
    assert.equal(JSON.stringify(audited).includes(emailOtp), false);
    assert.equal(
      ok(await fresh.auth.getUser(), 'Same Auth identity after change').user.id,
      createdEmployeeAuth,
    );
    assert.equal(ok(await fresh.auth.getUser(), 'Current verified email').user.email, updatedEmail);
    assert.equal(
      ok(await fresh.rpc('erp_account_security'), 'Original AAL2 session remains ready').ready,
      true,
    );
    ok(await fresh.auth.refreshSession(), 'Refresh after email change');
    assert.equal(
      ok(await fresh.rpc('erp_account_security'), 'Refreshed password and TOTP session').ready,
      true,
    );
    assert.ok(
      (await low.auth.signInWithPassword({ email: createdEmployeeEmail, password: initial })).error,
    );
    ok(
      await low.auth.signInWithPassword({ email: updatedEmail, password: initial }),
      'New address retains password',
    );
    createdEmployeeEmail = updatedEmail;
    ok(await anon.auth.resetPasswordForEmail(createdEmployeeEmail), 'Request native recovery link');
    const recoveryHash = await emailToken(createdEmployeeEmail, 'recovery', setupHash);
    const recovered = ok(
      await fresh.auth.verifyOtp({ token_hash: recoveryHash, type: 'recovery' }),
      'Accept native recovery',
    );
    assert.equal(recovered.user.id, createdEmployeeAuth);
    assert.equal(ok(await fresh.rpc('erp_account_security'), 'Recovery is AAL1').ready, false);
    const resetPassword = randomBytes(24).toString('hex');
    // GoTrue refuses a password change at AAL1 when the account has a verified factor.
    assert.ok((await fresh.auth.updateUser({ password: resetPassword })).error);
    await new Promise((resolve) =>
      setTimeout(resolve, (30 - (Math.floor(Date.now() / 1000) % 30)) * 1000 + 150),
    );
    ok(
      await fresh.auth.mfa.challengeAndVerify({
        factorId: employeeFactor.id,
        code: totp(employeeFactor.totp.secret),
      }),
      'Verify existing recovery TOTP',
    );
    assert.equal(
      ok(await fresh.rpc('erp_account_security'), 'Recovery with TOTP').ready,
      false,
      'Recovery session cannot replace password sign-in',
    );
    ok(await fresh.auth.updateUser({ password: resetPassword }), 'Reset native password');
    assert.ok(
      (await anon.auth.verifyOtp({ token_hash: recoveryHash, type: 'recovery' })).error,
      'Recovery link cannot replay',
    );
    ok(
      await fresh.auth.signInWithPassword({ email: createdEmployeeEmail, password: resetPassword }),
      'New password works',
    );
    const retained = ok(await fresh.auth.mfa.listFactors(), 'TOTP retained after reset');
    assert.ok(retained.totp.some((f) => f.id === employeeFactor.id));
    async function setAccess(enabled, roleIds = [role.id]) {
      const { version } = (
        await db.query('select version from garments_access.app_user where user_id=$1', [
          createdEmployeeAuth,
        ])
      ).rows[0];
      return user.rpc('erp_save_account_access', {
        p_user_id: createdEmployeeAuth,
        p_employee_id: createdEmployeeId,
        p_role_ids: roleIds,
        p_enabled: enabled,
        p_expected_version: version,
      });
    }
    createdRole = ok(
      await user.rpc('erp_save_role', {
        p_input: { name: 'Synthetic onboarding role', permissions: { colours: { view: true } } },
      }),
      'Create onboarding test role',
    );
    ok(await setAccess(true, [role.id, createdRole]), 'Administrator edits roles');
    const edit = ok(await user.rpc('erp_admin_snapshot'), 'Read assigned roles').accounts.find(
      (account) => account.user_id === createdEmployeeAuth,
    );
    assert.deepEqual(edit.role_ids.map(String).sort(), [role.id, createdRole].map(String).sort());
    assert.ok(
      (
        await fresh.rpc('erp_save_account_access', {
          p_user_id: createdEmployeeAuth,
          p_employee_id: createdEmployeeId,
          p_role_ids: [snap.roles.find((r) => r.is_system_admin).id],
          p_enabled: true,
          p_expected_version: edit.version,
        })
      ).error,
      'Employee cannot escalate own roles',
    );
    ok(await setAccess(true), 'Administrator removes extra role');
    const oldRefresh = (await fresh.auth.getSession()).data.session.refresh_token;
    ok(await setAccess(false), 'Administrator disables account');
    assert.equal(ok(await fresh.rpc('erp_account_security'), 'Disabled account').ready, false);
    assert.ok(
      (await fresh.auth.refreshSession({ refresh_token: oldRefresh })).error,
      'Disabled account refresh token revoked',
    );
    ok(
      await fresh.auth.signInWithPassword({ email: createdEmployeeEmail, password: resetPassword }),
      'Disabled identity can authenticate to Auth only',
    );
    assert.ok(
      (await fresh.auth.updateUser({ password: initial })).error,
      'Disabled account cannot write password',
    );
    ok(await setAccess(true), 'Administrator restores access');
    async function setEmployeeActive(active) {
      const { digest } = (
        await db.query('select md5(garments_erp.employee_document($1)::text) as digest', [
          createdEmployeeId,
        ])
      ).rows[0];
      return user.rpc('erp_set_employee_active', {
        p_id: createdEmployeeId,
        p_active: active,
        p_expected: digest,
      });
    }
    ok(await setEmployeeActive(false), 'HR deactivation');
    assert.ok((await setAccess(true)).error, 'Inactive employee cannot receive access');
    ok(await setEmployeeActive(true), 'HR reactivation');
    ok(
      await fresh.auth.signInWithPassword({ email: createdEmployeeEmail, password: resetPassword }),
      'Reactivated employee Auth sign-in',
    );
    assert.equal(
      ok(await fresh.rpc('erp_account_security'), 'HR reactivation keeps access disabled').enabled,
      false,
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
      'PASS Employee registration, cancellation, delayed Auth rejection, correction, interrupted provisioning, concurrent retries, resend/expiry, email OTP and atomic retry, password setup/recovery, TOTP, RBAC and revocation',
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
  if (retiredAuthId) await admin.auth.admin.deleteUser(retiredAuthId);
  for (const nonce of retiredInvitations)
    await db.query('delete from garments_access.cancelled_employee_invitation where nonce=$1', [
      nonce,
    ]);
  if (bucket && path) await admin.storage.from(bucket).remove([path]);
  if (employeePhotoTicket) {
    await admin.storage
      .from(employeePhotoTicket.bucket_id)
      .remove([employeePhotoTicket.storage_path]);
    await db.query('delete from garments_erp.app_file_upload where id=$1', [
      employeePhotoTicket.id,
    ]);
    if (employeePhoto)
      await db.query('delete from garments_erp.attachments where id=$1', [employeePhoto]);
  }
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
  if (createdRole) {
    await db.query(
      'delete from garments_access.app_role_resource_permission where app_role_id=$1',
      [createdRole],
    );
    await db.query('delete from garments_access.app_role where id=$1', [createdRole]);
  }
  if (createdEmployeeId) {
    await db.query(
      "delete from garments_access.app_activity_log where target_type='employee' and target_id=$1",
      [createdEmployeeId],
    );
    await db.query('delete from garments_access.employee_invitation where employee_id=$1', [
      createdEmployeeId,
    ]);
    await db.query('delete from garments_erp.employee where id=$1', [createdEmployeeId]);
  }
  await db.query('delete from garments_erp.contact_items where contact_id=900004');
  await db.query('delete from garments_erp.contacts where id=900004');
  if (uid) {
    await db.query('update garments_erp.yarn_bill set bill_attachment=null where id=900001');
    await db.query('delete from garments_erp.app_file_upload where created_by=$1', [uid]);
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
