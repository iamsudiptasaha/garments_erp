import test from 'node:test';
import assert from 'node:assert/strict';
import {
  employeeDraft,
  employeeRows,
  employeeRelations,
  validateEmployeeDraft,
} from '../src/hr/model.js';
import { verifyEmployeePassword } from '../src/hr/live.js';
test('employee draft contains only employee fields and FK links, never contact-owned details', () => {
  assert.deepEqual(Object.keys(employeeRelations), ['employee']);
  const record = {
    employee: {
      id: '9007199254740993',
      employee_code: 'SCE/00001',
      verified_by_employee_id: '3',
      contacts_id: '9',
      contact_purpose_id: '1',
      gender_id: '2',
    },
    contact: { company_name: 'Synthetic employee' },
    contacts: [{ id: '4', phone: 'fixture' }],
    banks: [{ account_number: 'must not copy' }],
  };
  const draft = employeeDraft(record);
  assert.equal(draft.employee.contacts_id, '9');
  assert.equal(draft.employee.gender_id, '2');
  assert.equal(draft.employee.verified_by_employee_id, undefined);
  assert.deepEqual(Object.keys(draft), ['employee']);
  assert.equal(draft.contact, undefined);
  assert.equal(draft.banks, undefined);
  assert.equal(employeeRows([record], 'synthetic')[0].id, '9007199254740993');
});
test('employee validation requires contact links, not duplicated contact input', () => {
  const draft = employeeDraft();
  assert.throws(() => validateEmployeeDraft(draft), /employee contact/);
  draft.employee.contacts_id = '1';
  assert.throws(() => validateEmployeeDraft(draft), /purpose/);
  draft.employee.contact_purpose_id = '1';
  assert.doesNotThrow(() => validateEmployeeDraft(draft));
  draft.employee.contact_purpose_emergency_id = '1';
  assert.throws(() => validateEmployeeDraft(draft), /emergency contact/);
});
test('immediate verification isolates the verifier and signs out its session on success or failure', async () => {
  const calls = [];
  const client = {
    auth: {
      signInWithPassword: async () => ({ error: null }),
      signOut: async (args) => calls.push(['signOut', args]),
    },
    rpc: async (name, args) => {
      calls.push([name, args]);
      return { data: 'one-use-proof', error: null };
    },
  };
  const input = {
    email: 'synthetic@example.invalid',
    password: 'synthetic fixture only',
    employeeId: '2',
    actor: 'operator',
    payload: { draft: {} },
  };
  assert.equal(await verifyEmployeePassword(input, () => client), 'one-use-proof');
  assert.equal(calls[0][1].p_employee, '2');
  assert.deepEqual(calls.at(-1), ['signOut', { scope: 'local' }]);
  client.auth.signInWithPassword = async () => ({ error: { message: 'fixture' } });
  calls.length = 0;
  await assert.rejects(
    () => verifyEmployeePassword(input, () => client),
    /password could not be verified/,
  );
  assert.deepEqual(calls, [['signOut', { scope: 'local' }]]);
});
