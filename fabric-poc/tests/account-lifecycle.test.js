import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountAction,
  recoveryCode,
  emailAddress,
  credentialDigest,
  phoneNumber,
  strongPassword,
} from '../../supabase/functions/erp-accounts/service.mjs';
function fake() {
  const events = [];
  return {
    events,
    pepper: 'test-only-pepper-with-at-least-32-characters',
    actor: async () => ({ id: 'admin' }),
    requireAdmin: async () => events.push('admin'),
    requireReady: async () => events.push('ready'),
    employeeAvailable: async () => {},
    createUser: async () => ({ id: 'new' }),
    link: async () => events.push('link'),
    removeUnlinked: async () => events.push('compensate'),
    linkedAccount: async () => ({ user_id: 'employee', employee_code: 'SCE/99999' }),
    reserve: async () => {
      events.push('reserve');
      return 'ticket';
    },
    sendCode: async () => events.push('mail'),
    cancel: async () => events.push('cancel'),
    consume: async () => {
      events.push('consume');
      return 'employee';
    },
    setPassword: async () => events.push('password'),
    passwordComplete: async () => events.push('complete'),
    verifyPassword: async () => events.push('verify'),
  };
}
test('account creation requires administrator before touching Auth and compensates failed linking', async () => {
  const io = fake();
  io.link = async () => {
    throw Error('stale');
  };
  await assert.rejects(
    accountAction(
      {
        action: 'create',
        employeeId: '12',
        phone: '9000000000',
        email: 'employee@example.invalid',
        roleIds: ['1'],
        enabled: true,
      },
      io,
    ),
    /could not be linked/,
  );
  assert.deepEqual(io.events, ['admin', 'compensate']);
});
test('denied actor cannot create Auth account or issue recovery', async () => {
  const io = fake();
  io.requireAdmin = async () => {
    throw Error('Denied');
  };
  await assert.rejects(accountAction({ action: 'issueRecovery', userId: 'other' }, io), /Denied/);
  assert.deepEqual(io.events, []);
});
test('recovery delivery failure invalidates the reserved credential', async () => {
  const io = fake();
  io.sendCode = async () => {
    throw Error('smtp');
  };
  await assert.rejects(
    accountAction({ action: 'issueRecovery', userId: 'employee' }, io),
    /No usable code/,
  );
  assert.deepEqual(io.events, ['admin', 'reserve', 'cancel']);
});
test('recovery consumes before changing password and never returns the credential', async () => {
  const io = fake();
  const r = await accountAction(
    {
      action: 'recover',
      phone: '9000000000',
      code: 'A'.repeat(32),
      password: 'a long synthetic password',
    },
    io,
  );
  assert.deepEqual(io.events, ['consume', 'password', 'complete']);
  assert.equal(JSON.stringify(r).includes('AAAA'), false);
});
test('invalid recovery never calls Auth password update', async () => {
  const io = fake();
  io.consume = async () => null;
  await assert.rejects(
    accountAction(
      {
        action: 'recover',
        phone: '9000000000',
        code: 'A'.repeat(32),
        password: 'a long synthetic password',
      },
      io,
    ),
    /invalid or expired/,
  );
  assert.deepEqual(io.events, []);
});
test('password change verifies MFA and current password then invalidates sessions', async () => {
  const io = fake();
  await accountAction(
    { action: 'changePassword', currentPassword: 'old', password: 'a long synthetic password' },
    io,
  );
  assert.deepEqual(io.events, ['ready', 'verify', 'password', 'complete']);
});
test('recovery digest requires a configured server pepper and is deterministic without exposing code', async () => {
  await assert.rejects(credentialDigest('code', ''), /not configured/);
  const d = await credentialDigest('code', 'a'.repeat(32));
  assert.equal(d.length, 64);
  assert.equal(d, await credentialDigest('code', 'a'.repeat(32)));
  assert.notEqual(d, await credentialDigest('code', 'b'.repeat(32)));
});
test('credentials enforce ten-digit phone and minimum password length', () => {
  assert.equal(phoneNumber('9000000000'), '+919000000000');
  assert.throws(() => phoneNumber('+919000000000'));
  assert.throws(() => strongPassword('short'));
});

test('recovery uses an eight-digit OTP while initial passwords retain high entropy', async () => {
  assert.match(recoveryCode(), /^[0-9]{8}$/);
  const io = fake();
  io.sendCode = async (_target, code) => assert.match(code, /^[0-9]{8}$/);
  await accountAction({ action: 'issueRecovery', userId: 'employee' }, io);
  io.createUser = async (_phone, password) => {
    assert.match(password, /^[A-F0-9]{32}$/);
    return { id: 'new' };
  };
  await accountAction(
    {
      action: 'create',
      employeeId: '12',
      phone: '9000000000',
      email: 'employee@example.invalid',
      roleIds: ['1'],
      enabled: true,
    },
    io,
  );
});

test('employee provisioning requires a usable email login and normalises it', () => {
  assert.equal(emailAddress(' Employee@Example.invalid '), 'employee@example.invalid');
  assert.throws(() => emailAddress(''), /login email/);
  assert.throws(() => emailAddress('not-an-email'), /login email/);
});
