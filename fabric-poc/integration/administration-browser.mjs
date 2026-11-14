import assert from 'node:assert/strict';
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { totp } from './billing-totp.mjs';

const runtime = JSON.parse(
  readFileSync(process.env.TEST_RUNTIME_FILE || '/tmp/erp-test-runtime.json'),
);
assert.match(runtime.API_URL, /^http:\/\/127[.]0[.]0[.]1:(55421|58621)$/);
const dbUrl = new URL(runtime.DB_URL);
assert.equal(dbUrl.hostname, '127.0.0.1');
assert.equal(Number(dbUrl.port), Number(new URL(runtime.API_URL).port) + 1);
const db = new pg.Client({ connectionString: runtime.DB_URL });
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const client = (key = runtime.ANON_KEY) => createClient(runtime.API_URL, key, options);
const service = client(runtime.SERVICE_ROLE_KEY);
const app = 'http://127.0.0.1:18687';
const suffix = randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
const phone = '+1' + randomInt(2000000000, 9000000000);
const targetName = 'Lifecycle employee ' + suffix;
const roleName = 'Permission matrix ' + suffix;

function ok(result) {
  if (result.error) throw result.error;
  return result.data;
}
async function authenticate(user, email, factor) {
  const { session } = ok(await user.auth.signInWithPassword({ email, password }));
  factor ??= ok(await user.auth.mfa.enroll({ factorType: 'totp' }));
  ok(
    await user.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(factor.totp.secret) }),
  );
  return { factor, session: ok(await user.auth.getSession()).session, previousSession: session };
}
async function createLinkedAccount(name, role, phone) {
  const email = role + '-' + suffix + '@example.invalid';
  const { user: identity } = ok(
    await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      phone,
      phone_confirm: !!phone,
    }),
  );
  const {
    rows: [employee],
  } = await db.query(
    `with contact as (
      insert into garments_erp.contacts(company_name) values($1) returning id
    ) insert into garments_erp.employee(employee_code,contacts_id,contact_purpose_id,is_verified,verified_by_employee_id)
      select null,id,900001,true,900001 from contact returning id`,
    [name],
  );
  await db.query(
    'insert into garments_access.app_user(user_id,employee_id,is_active) values($1,$2,true)',
    [identity.id, employee.id],
  );
  await db.query(
    'insert into garments_access.app_user_role(user_id,role_id) select $1,id from garments_access.app_role where key=$2',
    [identity.id, role],
  );
  return { email, id: identity.id, employeeId: employee.id, user: client() };
}

const browser = await chromium.launch();
await db.connect();
async function openPage(session, width, path) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.route('https://erp-local.invalid/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: runtime.API_URL + url.pathname + url.search });
    await route.fulfill({ response });
  });
  await context.addInitScript(
    (value) => localStorage.setItem('sb-erp-local-auth-token', JSON.stringify(value)),
    session,
  );
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(app + '/access.html#' + path);
  return page;
}
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const checkbox = (scope, name) => scope.getByRole('checkbox', { name, exact: true });
try {
  const admin = await createLinkedAccount('Lifecycle administrator ' + suffix, 'ci_admin');
  const target = await createLinkedAccount(targetName, 'ci_viewer', phone);
  const [{ session }, { factor, session: activeSession }] = await Promise.all([
    authenticate(admin.user, admin.email),
    authenticate(target.user, target.email),
  ]);

  const page = await openPage(session, 1440, 'adminRoles');
  const dialog = page.getByRole('dialog');
  await button(page, 'Create role').click();
  await dialog.getByLabel('Role name').fill(roleName);
  await checkbox(dialog, 'Production: edit').check();
  await expect(checkbox(dialog, 'Production: view')).toBeChecked();
  await expect(checkbox(dialog, 'Colours: view')).not.toBeChecked();
  await expect(checkbox(dialog, 'Production: delete')).toBeDisabled();
  await button(dialog, 'Production').click();
  const child = dialog
    .getByRole('rowgroup')
    .filter({ has: page.getByRole('button', { name: 'Production', exact: true }) })
    .getByRole('checkbox', { name: /: edit$/ })
    .nth(1);
  await child.uncheck();
  await expect(checkbox(dialog, 'Production: edit')).toHaveJSProperty('indeterminate', true);
  await expect(checkbox(dialog, 'All sections: edit')).toHaveJSProperty('indeterminate', true);
  await checkbox(dialog, 'Production: edit').check();
  await button(dialog, 'Collapse all').click();
  await expect(child).toHaveCount(0);
  await button(dialog, 'Expand all').click();
  await expect(child).toBeChecked();
  await button(dialog, 'Save role').click();
  await expect(dialog).toBeHidden();

  const mobile = await openPage(session, 390, 'adminRoles');
  const mobileDialog = mobile.getByRole('dialog');
  await button(mobile.getByRole('row').filter({ hasText: roleName }), 'Edit permissions').click();
  await expect(checkbox(mobileDialog, 'Production: edit')).toBeChecked();
  await checkbox(mobileDialog, 'Production: view').uncheck();
  await expect(checkbox(mobileDialog, 'Production: edit')).not.toBeChecked();
  await checkbox(mobileDialog, 'Production: create').check();
  await expect(checkbox(mobileDialog, 'Production: view')).toBeChecked();
  await expect(checkbox(mobileDialog, 'Production: edit')).not.toBeChecked();
  await button(mobileDialog, 'Save role').click();
  await expect(mobileDialog).toBeHidden();
  console.log(
    'PASS desktop/mobile permission dependencies, mixed state, collapse and persisted saves',
  );

  await page.goto(app + '/access.html#adminAccess');
  const row = page.getByRole('row').filter({ hasText: targetName });
  async function review(action) {
    await button(row, 'View details').click();
    await button(dialog, action).click();
    await button(dialog, 'Review').click();
    await expect(dialog.getByRole('heading', { name: 'Review: ' + action })).toBeVisible();
  }
  const accounts = async () => ok(await admin.user.rpc('erp_admin_snapshot')).accounts;
  const account = async () => (await accounts()).find((entry) => entry.user_id === target.id);
  const initial = await account();
  const args = {
    p_action: 'remove',
    p_user_id: target.id,
    p_employee_id: target.employeeId,
    p_expected_version: initial.version,
  };
  assert.equal((await target.user.rpc('erp_change_account_lifecycle', args)).error.code, '42501');
  await review('Deactivate');
  assert.equal((await account()).is_active, true);
  await button(dialog, 'Back').click();
  await expect(button(dialog, 'Review')).toBeVisible();
  await button(dialog, 'Review').click();
  await button(dialog, 'Confirm Deactivate').click();
  await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
  assert.deepEqual((await account()).role_ids, initial.role_ids);
  assert.ok((await client().auth.signInWithPassword({ email: target.email, password })).error);
  assert.ok(
    (await client().auth.refreshSession({ refresh_token: activeSession.refresh_token })).error,
  );
  assert.equal(ok(await target.user.rpc('erp_account_security')).ready, false);
  assert.equal((await admin.user.rpc('erp_change_account_lifecycle', args)).error.code, '40001');

  await review('Reactivate');
  await button(dialog, 'Confirm Reactivate').click();
  await expect(row.getByText('Enabled', { exact: true })).toBeVisible();
  await authenticate(target.user, target.email, factor);
  assert.equal(ok(await target.user.rpc('erp_account_security')).ready, true);

  await db.query(
    `insert into garments_access.app_activity_log(actor_user_id, action, target_type, target_id)
    values($1,'Lifecycle history fixture','employee',$2)`,
    [target.id, String(target.employeeId)],
  );
  await review('Remove Access');
  assert.ok(await account());
  await button(dialog, 'Confirm Remove Access').click();
  await expect(row.getByText('No access', { exact: true })).toBeVisible();
  assert.equal(await account(), undefined);
  assert.equal(ok(await target.user.rpc('erp_account_security')).ready, false);
  assert.ok((await client().auth.signInWithPassword({ email: target.email, password })).error);
  const {
    rows: [retired],
  } = await db.query(
    `select
    (select deleted_at is not null and email is null and phone is null from auth.users where id=$1) as identity,
    exists(select 1 from garments_erp.employee where id=$2) as profile,
    exists(select 1 from garments_access.app_activity_log where actor_user_id=$1 and action='Lifecycle history fixture') as history,
    not exists(select 1 from garments_access.app_user_role where user_id=$1) as no_roles,
    not exists(select 1 from auth.sessions where user_id=$1) as no_sessions`,
    [target.id, target.employeeId],
  );
  assert.deepEqual(retired, {
    identity: true,
    profile: true,
    history: true,
    no_roles: true,
    no_sessions: true,
  });
  const { user: replacement } = ok(
    await service.auth.admin.createUser({
      email: target.email,
      phone,
      password,
      email_confirm: true,
      phone_confirm: true,
    }),
  );
  assert.notEqual(replacement.id, target.id);
  assert.equal(
    (await accounts()).some((entry) => entry.user_id === replacement.id),
    false,
  );
  assert.ok(
    (
      await admin.user.rpc('erp_save_account_access', {
        p_user_id: target.id,
        p_employee_id: target.employeeId,
        p_role_ids: initial.role_ids,
        p_enabled: true,
        p_expected_version: null,
      })
    ).error,
    'Retired identity cannot be relinked',
  );
  ok(await service.auth.admin.deleteUser(replacement.id));
  console.log(
    'PASS reviewed deactivation, reactivation and removal, Auth and session revocation, identifier reuse and historical identity',
  );
} finally {
  await Promise.all(browser.contexts().map((context) => context.unrouteAll({ behavior: 'wait' })));
  await browser.close();
  await db.end();
}
