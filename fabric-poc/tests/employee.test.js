import test from 'node:test';
import assert from 'node:assert/strict';
import {
  employeeDraft,
  employeeRows,
  employeeRelations,
  validateEmployeeDraft,
} from '../src/hr/model.js';
import { employeeCommands } from '../src/hr/live.js';
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
test('employee commands use operator attribution and revision-checked activation without password proof', async () => {
  const calls = [];
  const commands = employeeCommands({
    rpc: async (name, args) => {
      calls.push([name, args]);
      return { data: { records: [] }, error: null };
    },
  });
  const payload = { id: '9007199254740993', draft: { employee: {} } };
  await commands.save(payload);
  await commands.setActive(payload.id, false, 'revision');
  assert.deepEqual(calls, [
    ['erp_save_employee', { p_payload: payload, p_proof: null }],
    ['erp_set_employee_active', { p_id: payload.id, p_active: false, p_expected: 'revision' }],
  ]);
  await assert.rejects(
    () =>
      employeeCommands({
        rpc: async () => ({ error: { message: 'Employee changed. Reload before saving.' } }),
      }).setActive('1', true, 'stale'),
    /Employee changed/,
  );
});
test('inactive employee projections retain status while editable drafts exclude server-owned state', () => {
  const record = {
    employee: { id: '1', is_active: false, is_verified: true, activated_by_employee_id: '2' },
    contact: { company_name: 'Test' },
    contacts: [],
  };
  assert.equal(employeeRows([record])[0].status, 'Inactive');
  const draft = employeeDraft(record).employee;
  assert.equal(draft.is_active, undefined);
  assert.equal(draft.is_verified, undefined);
  assert.equal(draft.activated_by_employee_id, undefined);
});
