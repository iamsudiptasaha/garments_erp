import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialAccess,
  allowed,
  saveRole,
  saveEmployee,
  saveAccountAccess,
  isAdministrator,
  upgradeAccess,
} from '../src/admin/model.js';
import { initialFabric, fabricRows } from '../src/fabric/domain.js';
import { pages } from '../src/fabric/catalog.js';
import { buildSheet, csvFor } from '../src/fortune-state.js';
test('permissions deny by default and disabled employees lose access immediately', () => {
  const access = initialAccess();
  assert.equal(allowed(access, 'unknown', 'knitting', 'view'), false);
  assert.equal(allowed(access, 'sample-viewer', 'knitting', 'view'), true);
  assert.equal(allowed(access, 'sample-viewer', 'knitting', 'edit'), false);
  assert.equal(allowed(access, 'owner', 'missing', 'view'), false);
  access.users[0].active = false;
  assert.equal(allowed(access, 'owner', 'adminUsers', 'edit'), false);
});
test('non-admin actors cannot mutate access settings', () => {
  const access = initialAccess();
  assert.throws(
    () => saveRole(access, 'sample-viewer', { name: 'Escalated', permissions: {} }),
    /does not allow/,
  );
  assert.throws(
    () =>
      saveEmployee(access, 'sample-accounts', {
        name: 'Actor',
        employeeCode: 'E-99',
        phone: '+919999999999',
        roleId: 'admin',
        active: true,
      }),
    /does not allow/,
  );
});
test('role saves validate view dependencies, protect admin and record audit events', () => {
  const access = initialAccess();
  assert.throws(
    () => saveRole(access, 'owner', { id: 'admin', name: 'Changed', permissions: {} }),
    /protected/,
  );
  assert.throws(
    () => saveRole(access, 'owner', { name: 'Bad', permissions: { knitting: { edit: true } } }),
    /View must/,
  );
  const next = saveRole(
    access,
    'owner',
    { name: 'Knitting reader', permissions: { knitting: { view: true } } },
    0,
  );
  assert.equal(next.roles.length, 5);
  assert.equal(next.audit[0].action, 'Created role');
  assert.equal(access.roles.length, 4);
  assert.throws(() => saveRole(next, 'owner', { name: 'Stale', permissions: {} }, 0), /changed/);
});
test('employee saves preserve identity, prevent duplicates and protect the last admin', () => {
  const access = initialAccess();
  assert.throws(
    () =>
      saveAccountAccess(access, 'owner', {
        id: access.users[0].id,
        roleId: 'admin',
        active: false,
      }),
    /at least one active administrator/,
  );
  assert.throws(
    () => saveEmployee(access, 'owner', { ...access.users[1], employeeCode: 'ADMIN-001' }),
    /already assigned/,
  );
  const next = saveEmployee(access, 'owner', { ...access.users[1], phone: '+919999999999' }, 0);
  assert.equal(next.users[1].id, 'sample-accounts');
  assert.equal(next.audit.length, 1);
  assert.throws(
    () =>
      saveEmployee(next, 'owner', { name: 'Another', employeeCode: 'E-5', phone: '+919999999999' }),
    /already assigned/,
  );
});
test('greige dyers render on separate lines without changing underlying values', () => {
  const data = initialFabric(),
    rows = fabricRows(data, 'greige'),
    record = rows.find((r) => r.bill === 'KB-026' && r.name === '30S Sinker'),
    state = {
      records: [record],
      columns: pages.greige.columns,
      styles: {},
      layout: {},
      sort: { key: 'bill', direction: 'asc' },
    };
  const sheet = buildSheet(state),
    dyers = sheet.celldata.find((c) => c.r === 1 && c.c === 3);
  assert.equal(record.dyers, 'River Dyeing, City Processors');
  assert.equal(dyers.v.v, 'River Dyeing,\nCity Processors');
  assert.equal(dyers.v.tb, '2');
  assert.ok(sheet.config.rowlen[1] >= 58);
  assert.match(csvFor(state), /"River Dyeing,\nCity Processors"/);
});

test('sheet zoom is a persistent presentation setting and leaves record values unchanged', () => {
  const data = initialFabric(),
    records = fabricRows(data, 'greige'),
    state = {
      records,
      columns: pages.greige.columns,
      styles: {},
      layout: { zoomRatio: 1.25 },
      sort: { key: 'bill', direction: 'asc' },
    };
  const sheet = buildSheet(state);
  assert.equal(sheet.zoomRatio, 1.25);
  assert.equal(records[0].dyers, 'River Dyeing, City Processors');
});

test('missing edit targets cannot be used to bypass create permissions', () => {
  const access = initialAccess();
  assert.throws(
    () => saveRole(access, 'owner', { id: 'missing', name: 'Role', permissions: {} }),
    /no longer exists/,
  );
  assert.throws(
    () =>
      saveEmployee(access, 'owner', {
        id: 'missing',
        name: 'Staff',
        employeeCode: 'E-9',
        phone: '+919999999999',
        roleId: 'viewer',
        active: true,
      }),
    /no longer exists/,
  );
});

test('HR can manage employee profiles but cannot grant roles or enable login', () => {
  let access = initialAccess();
  access = saveRole(access, 'owner', {
    name: 'HR',
    permissions: { employees: { view: true, create: true, edit: true } },
  });
  const role = access.roles.find((r) => r.name === 'HR');
  access = saveAccountAccess(access, 'owner', {
    id: 'sample-accounts',
    roleId: role.id,
    active: true,
  });
  assert.equal(allowed(access, 'sample-accounts', 'employees', 'create'), true);
  assert.equal(isAdministrator(access, 'sample-accounts'), false);
  const next = saveEmployee(access, 'sample-accounts', {
    name: 'New staff',
    employeeCode: 'HR-100',
    phone: '+918888888888',
  });
  const employee = next.users.find((u) => u.employeeCode === 'HR-100');
  assert.equal(employee.active, false);
  assert.equal(employee.roleId, 'viewer');
  assert.throws(
    () => saveEmployee(access, 'sample-accounts', { ...access.users[1], roleId: 'admin' }),
    /only be changed in Administration/,
  );
  assert.throws(
    () =>
      saveAccountAccess(access, 'sample-accounts', {
        id: 'sample-viewer',
        roleId: 'admin',
        active: true,
      }),
    /does not allow/,
  );
});
test('administration stays admin-only even when a non-admin role contains stray grants', () => {
  const access = initialAccess();
  access.roles.find((r) => r.id === 'viewer').permissions.adminRoles = { view: true, edit: true };
  assert.equal(allowed(access, 'sample-viewer', 'adminRoles', 'view'), false);
  assert.throws(
    () =>
      saveRole(access, 'owner', {
        name: 'Delegated admin',
        permissions: { adminAudit: { view: true } },
      }),
    /reserved for Administrator/,
  );
});
test('access-state upgrade moves employee permissions to HR without losing people or audit history', () => {
  const access = initialAccess();
  access.version = 1;
  access.roles[0].permissions.adminUsers = { view: true, create: true, edit: true };
  access.roles[1].permissions.adminUsers = { view: true, edit: true };
  const next = upgradeAccess(access);
  assert.equal(next.version, 2);
  assert.deepEqual(next.users, access.users);
  assert.deepEqual(next.audit, access.audit);
  assert.equal(next.roles[0].permissions.adminUsers, undefined);
  assert.equal(next.roles[1].permissions.employees.edit, true);
  assert.equal(allowed(next, 'sample-accounts', 'adminRoles', 'view'), false);
});

test('archiving retains history and refuses assigned or protected roles', async () => {
  const { archiveRole } = await import('../src/admin/model.js');
  let state = initialAccess();
  assert.throws(() => archiveRole(state, 'owner', 'admin', state.revision), /Administrator/);
  assert.throws(
    () => archiveRole(state, 'owner', 'accounts', state.revision),
    /Reassign all employees/,
  );
  state = saveRole(state, 'owner', { name: 'Unused role', permissions: {} }, state.revision);
  const role = state.roles.find((r) => r.name === 'Unused role'),
    archived = archiveRole(state, 'owner', role.id, state.revision);
  assert.equal(archived.roles.find((r) => r.id === role.id).archived, true);
  assert.equal(archived.audit[0].action, 'Archived role');
  assert.ok(
    state.roles.find((r) => r.id === role.id) &&
      !state.roles.find((r) => r.id === role.id).archived,
  );
  assert.throws(
    () =>
      saveAccountAccess(
        archived,
        'owner',
        { id: 'sample-viewer', roleId: role.id, active: true },
        archived.revision,
      ),
    /valid role/,
  );
  const disabled = structuredClone(state);
  disabled.users.find((u) => u.id === 'sample-accounts').active = false;
  assert.throws(
    () => archiveRole(disabled, 'owner', 'accounts', disabled.revision),
    /disabled accounts/,
  );
});
