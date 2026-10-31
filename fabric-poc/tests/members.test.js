import test from 'node:test';
import assert from 'node:assert/strict';
import { employeeMatches } from '../src/admin/members.js';
test('employee search matches names, full code, suffix and phone without case sensitivity', () => {
  const employee = { name: 'Asha Sharma', code: 'SCE/00015', phone: '+919876543210' };
  assert.ok(employeeMatches(employee, 'ASHA'));
  assert.ok(employeeMatches(employee, '00015'));
  assert.ok(employeeMatches(employee, 'sce/00015'));
  assert.ok(employeeMatches(employee, '98765'));
  assert.equal(employeeMatches(employee, 'unknown'), false);
  assert.ok(employeeMatches({ code: 'SCE/00002' }, '00002'));
});
