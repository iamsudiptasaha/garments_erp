import test from 'node:test';
import assert from 'node:assert/strict';
import { accountAction, strongPassword } from '../../supabase/functions/erp-accounts/service.mjs';
import { readPasswordLink } from '../src/access/security.js';

const invitation = {
  action: 'invite',
  employeeId: '12',
  email: ' Employee@Example.invalid ',
  roleIds: ['1'],
};

test('Admin validation precedes sending an invitation and linking roles', async () => {
  const events = [];
  const io = {
    actor: async () => ({ id: 'admin' }),
    requireAdmin: async () => events.push('admin'),
    invitation: async (...args) => {
      events.push(args);
      return {
        state: 'send',
        email: 'employee@example.invalid',
        nonce: 'nonce',
        revision: 'revision',
      };
    },
    invite: async (...args) => events.push(args),
  };
  await accountAction(invitation, io);
  assert.deepEqual(events, [
    'admin',
    ['invite', '12', 'employee@example.invalid', ['1'], null],
    ['employee@example.invalid', 'nonce'],
    ['finish', '12', null, null, 'revision'],
  ]);
  io.requireAdmin = async () => {
    throw Error('Denied');
  };
  await assert.rejects(accountAction(invitation, io), /Denied/);
  assert.equal(events.length, 4);
});

test('SMTP failure does not link or grant access', async () => {
  const io = {
    actor: async () => ({ id: 'admin' }),
    requireAdmin: async () => {},
    invitation: async (action) => {
      assert.equal(action, 'invite');
      return { state: 'send', email: invitation.email };
    },
    invite: async () => {
      throw Error('delivery failed');
    },
  };
  await assert.rejects(accountAction(invitation, io), /delivery failed/);
});

test('provisioning retry uses the original server reservation without sending another email', async () => {
  const result = await accountAction(
    { action: 'retry', employeeId: 12, email: 'ignored', revision: 'reserved' },
    {
      actor: async () => ({ id: 'admin' }),
      requireAdmin: async () => {},
      invitation: async (...args) => {
        assert.deepEqual(args, ['retry', '12', null, null, 'reserved']);
        return { state: 'linked' };
      },
      invite: () => assert.fail('unexpected email'),
    },
  );
  assert.equal(result.message, 'Employee access linked.');
});

test('signed-in password change verifies MFA and current password and then invalidates sessions', async () => {
  const events = [];
  await accountAction(
    { action: 'changePassword', currentPassword: 'old', password: 'a long synthetic password' },
    {
      actor: async () => ({ id: 'employee' }),
      requireReady: async () => events.push('ready'),
      verifyPassword: async () => events.push('verify'),
      setPassword: async () => events.push('password'),
      passwordComplete: async () => events.push('complete'),
    },
  );
  assert.deepEqual(events, ['ready', 'verify', 'password', 'complete']);
  assert.throws(() => strongPassword('short'));
});

test('only native invitation and recovery link types open the password screen', () => {
  assert.deepEqual(readPasswordLink('#type=invite&token_hash=abc'), {
    type: 'invite',
    tokenHash: 'abc',
  });
  assert.deepEqual(readPasswordLink('#type=recovery&token_hash=xyz'), {
    type: 'recovery',
    tokenHash: 'xyz',
  });
  assert.equal(readPasswordLink('#type=recovery'), null);
  assert.equal(readPasswordLink('#type=email_change&token_hash=abc'), null);
});

test('cancel never sends mail and correction finishes only its replacement reservation', async () => {
  const events = [];
  const io = {
    actor: async () => ({ id: 'admin' }),
    requireAdmin: async () => {},
    invitation: async (...args) => {
      events.push(args);
      return args[0] === 'cancel'
        ? { state: 'cancelled' }
        : { state: 'send', email: 'correct@example.invalid', nonce: 'new-nonce', revision: 'new' };
    },
    invite: async (...args) => events.push(args),
  };
  await accountAction({ action: 'cancel', employeeId: 12, revision: 'old' }, io);
  await accountAction(
    { action: 'correct', employeeId: 12, revision: 'old', email: ' Correct@Example.invalid ' },
    io,
  );
  assert.deepEqual(events, [
    ['cancel', '12', null, null, 'old'],
    ['correct', '12', 'correct@example.invalid', null, 'old'],
    ['correct@example.invalid', 'new-nonce'],
    ['finish', '12', null, null, 'new'],
  ]);
});
