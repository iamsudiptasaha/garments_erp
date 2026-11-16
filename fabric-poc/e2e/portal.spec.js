import { test, expect } from '@playwright/test';
const hosted = !!process.env.E2E_BASE_URL;
test('portable root has a usable landing page or production sign-in', async ({ page }) => {
  await page.goto('/');
  if (hosted) {
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Documents by section' })).toBeVisible();
  }
});
test('direct sign-in entry remains accessible', async ({ page }) => {
  await page.goto('/access.html');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
});
test('overview and Fabric overview are distinct, navigable pages', async ({ page }) => {
  test.skip(hosted, 'Hosted smoke tests do not authenticate or write production data');
  await page.goto('/fabric.html');
  await page.getByRole('button', { name: 'Fabric overview', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Know what came in. See where it went.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
});
test('live entry never falls back to sample records without authentication', async ({ page }) => {
  await page.goto('/fabric.html?live=1');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(
    page.getByText('Local workspace · sample data · no live database writes'),
  ).toHaveCount(0);
});
test('lab-dip swatch locks status and shade fields while keeping the date editable', async ({
  page,
}) => {
  test.skip(hosted, 'Hosted smoke tests never open write forms');
  await page.goto('/fabric.html#labDips');
  await page.getByRole('button', { name: '+ Create edition', exact: true }).click();
  await page.getByLabel('Shade card number', { exact: true }).fill('test-only');
  await page.getByLabel('Attached swatch', { exact: true }).check();
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Shade card number', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Shade card number', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Shade card option', { exact: true })).toBeDisabled();
  const date = page.getByLabel('Review date', { exact: true });
  await expect(date).toBeEnabled();
  await date.fill('2026-10-30');
  await expect(date).toHaveValue('2026-10-30');
  await page.getByLabel('Attached swatch', { exact: true }).uncheck();
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});
test('successful sign-in lands on Overview using a mocked transport, never a real account', async ({
  page,
}, testInfo) => {
  test.skip(hosted, 'Hosted smoke tests do not submit login credentials');
  const id = '00000000-0000-4000-8000-000000000003';
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = [
    part({ alg: 'HS256', typ: 'JWT' }),
    part({ sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }),
    'synthetic_test_signature',
  ].join('.');
  const profile = {
    name: 'Employee Test',
    email: 'employee@example.invalid',
    phone: '',
    employeeId: '87',
    roles: ['Production operator'],
  };
  await page.route('https://example.invalid/**', async (route) => {
    const url = route.request().url();
    let body = {};
    if (url.includes('/auth/v1/token'))
      body = {
        access_token: token,
        refresh_token: 'synthetic_refresh',
        token_type: 'bearer',
        expires_in: 3600,
        user: {
          id,
          phone: '919000000000',
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
        },
      };
    else if (url.includes('erp_my_profile')) body = profile;
    else if (url.includes('erp_save_my_profile')) {
      const input = route.request().postDataJSON();
      profile.name = input.p_name;
      profile.phone = input.p_phone;
      body = null;
    } else if (url.includes('erp_account_security'))
      return route.fulfill({ json: { enabled: true, ready: true, mustChangePassword: false } });
    if (url.includes('erp_access_snapshot'))
      body = {
        actor: id,
        enabled: true,
        administrator: false,
        permissions: { orders: { view: true } },
      };
    else if (url.includes('erp_fabric_snapshot')) body = { _live: true };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.goto('/access.html');
  await page.getByLabel('Email', { exact: true }).fill('employee@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(
    page.locator('.workspace-toolbar').getByRole('link', { name: 'Account settings' }),
  ).toHaveCount(0);
  const account = page.getByLabel('Personal account', { exact: true });
  await account.click();
  await expect(page.getByRole('navigation', { name: 'Personal account actions' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Account settings', exact: true })).toHaveAttribute(
    'href',
    '/access.html#profile',
  );
  await page.getByRole('link', { name: 'Account settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Profile', exact: true })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Updated Employee');
  await page.getByLabel('Primary phone', { exact: true }).fill('+91 555 123 4567');
  await page.getByRole('button', { name: 'Save personal details' }).click();
  await expect(account.getByText('Updated Employee')).toBeVisible();
  await expect(page.getByText('Production operator', { exact: true })).toBeVisible();
  await expect(page.getByText('employee@example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByText('Change my password', { exact: true })).toBeVisible();
  await expect(page.getByText('Update Email', { exact: true })).toHaveCount(0);
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.fillStyle = '#b8d9ef';
    context.fillRect(0, 0, 300, 150);
    context.fillStyle = '#345e80';
    context.fillRect(95, 20, 65, 110);
    return canvas.toDataURL();
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'test-avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png.split(',')[1], 'base64'),
  });
  const crop = page.getByLabel('Circular crop preview');
  await expect(crop).toBeVisible();
  const bounds = await crop.boundingBox();
  await page.mouse.move(bounds.x + 60, bounds.y + 60);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 90, bounds.y + 60);
  await page.mouse.up();
  await page.getByLabel('Zoom', { exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: testInfo.outputPath('my-profile-crop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cancel crop' }).click();
  await account.click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
});

test('email password login stops at Authenticator without loading business data', async ({
  page,
}) => {
  test.skip(hosted, 'Hosted smoke tests do not submit credentials');
  const id = '00000000-0000-4000-8000-000000000003';
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = [
    part({ alg: 'HS256', typ: 'JWT' }),
    part({
      sub: id,
      role: 'authenticated',
      aal: 'aal1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    'synthetic_test_signature',
  ].join('.');
  const user = {
    id,
    email: 'employee@example.invalid',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    factors: [
      {
        id: '00000000-0000-4000-8000-000000000004',
        factor_type: 'totp',
        status: 'verified',
        friendly_name: 'Test authenticator',
      },
    ],
  };
  const business = [];
  await page.route('https://example.invalid/**', async (route) => {
    const url = route.request().url();
    let body = {};
    if (url.includes('/auth/v1/token')) {
      expect(route.request().postDataJSON().email).toBe('employee@example.invalid');
      body = {
        access_token: token,
        refresh_token: 'synthetic_refresh',
        token_type: 'bearer',
        expires_in: 3600,
        user,
      };
    } else if (url.includes('/auth/v1/user')) body = user;
    else if (url.includes('erp_account_security'))
      body = { enabled: true, ready: false, mustChangePassword: false };
    else if (url.includes('/rest/v1/')) business.push(url);
    await route.fulfill({ json: body });
  });
  await page.goto('/access.html');
  await page.getByLabel('Email', { exact: true }).fill('employee@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Google Authenticator', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Authenticator code', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/access\.html/);
  expect(business).toEqual([]);
});
test('employee status actions and automatic verification preserve inactivity on edit', async ({
  page,
}, testInfo) => {
  test.skip(hosted, 'Hosted smoke tests never change employees');
  await page.goto('/fabric.html#employees');
  const card = page.locator('.hr-person-card').first();
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: /^Deactivate / })).toHaveCount(0);
  await card.getByRole('button', { name: 'Open profile →' }).click();
  const statusDialog = page.getByRole('dialog');
  await expect(statusDialog.getByLabel('Primary contact email')).toHaveAttribute('readonly', '');
  await page.screenshot({ path: testInfo.outputPath('employee-contact-email.png') });
  await statusDialog.getByRole('button', { name: 'Status', exact: true }).click();
  await expect(statusDialog.getByLabel('Verified by', { exact: true })).toHaveAttribute(
    'readonly',
    '',
  );
  await statusDialog
    .getByRole('combobox', { name: 'Status', exact: true })
    .selectOption('inactive');
  await statusDialog.getByRole('button', { name: 'Review status', exact: true }).click();
  await statusDialog.getByRole('button', { name: 'Confirm & save status', exact: true }).click();
  await expect(card.locator('.hr-status')).toHaveText('Inactive');
  await card.getByRole('button', { name: 'Open profile →' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Verified by', { exact: true })).toHaveAttribute('readonly', '');
  await expect(dialog.locator('input[type=password]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Contact links', exact: true }).click();
  await dialog.getByRole('combobox', { name: /Employee contact/ }).click();
  await page.getByRole('listbox').getByRole('option').first().click();
  await dialog.getByRole('button', { name: 'Review employee', exact: true }).click();
  await expect(dialog.getByText('Inactive · unchanged on save', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm & save employee', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.hr-person-card .hr-status').first()).toHaveText('Inactive');
  await page
    .locator('.hr-person-card')
    .first()
    .getByRole('button', { name: 'Open profile →' })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Status', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Status', exact: true })
    .selectOption('active');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Review status', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm & save status', exact: true })
    .click();
  await expect(page.locator('.hr-person-card .hr-status').first()).toHaveText('Active');
});

test('native invitation requires a deliberate click before setting a password', async ({
  page,
}, testInfo) => {
  test.skip(hosted, 'Uses synthetic Auth responses');
  const id = '00000000-0000-4000-8000-000000000003';
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = {
    id,
    email: 'employee@example.invalid',
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
  };
  const requests = [];
  await page.route('https://example.invalid/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/auth/v1/verify') {
      requests.push(path);
      expect(request.postDataJSON()).toMatchObject({
        token_hash: 'synthetic-invitation',
        type: 'invite',
      });
      return route.fulfill({
        json: {
          user,
          access_token: [
            part({ alg: 'HS256', typ: 'JWT' }),
            part({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 }),
            'synthetic',
          ].join('.'),
          refresh_token: 'synthetic_refresh',
          token_type: 'bearer',
          expires_in: 3600,
        },
      });
    }
    if (path === '/rest/v1/rpc/erp_account_security')
      return route.fulfill({ json: { enabled: true, ready: false, mustChangePassword: true } });
    if (path === '/auth/v1/user') {
      if (request.method() === 'PUT') {
        expect(request.postDataJSON()).toMatchObject({ password: 'synthetic-password-123' });
        requests.push(path);
      }
      return route.fulfill({ json: user });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/access.html#type=invite&token_hash=synthetic-invitation');
  await expect(page.getByRole('heading', { name: 'Accept invitation' })).toBeVisible();
  await expect(page).toHaveURL(/access\.html$/);
  expect(requests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('accept-invitation.png') });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('New password', { exact: true }).fill('synthetic-password-123');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(requests).toEqual(['/auth/v1/verify', '/auth/v1/user']);
});

test('Forgot password sends a native email request and shows a generic response', async ({
  page,
}, testInfo) => {
  test.skip(hosted, 'Uses synthetic Auth responses');
  let recovery;
  await page.route(
    (url) => url.origin === 'https://example.invalid' && url.pathname === '/auth/v1/recover',
    async (route) => {
      const request = route.request();
      recovery = {
        email: request.postDataJSON().email,
        redirect: new URL(request.url()).searchParams.get('redirect_to'),
      };
      await route.fulfill({ status: 429, json: { message: 'rate limited' } });
    },
  );
  await page.goto('/access.html');
  await expect(page.getByRole('button', { name: /phone login/i })).toHaveCount(0);
  await page.getByText('Forgot password?', { exact: true }).click();
  await page.getByLabel('Registered email').fill('employee@example.invalid');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'If this email is registered, you will receive a password reset link.',
  );
  expect(recovery).toEqual({
    email: 'employee@example.invalid',
    redirect: new URL('/access.html', page.url()).href,
  });
  await page.screenshot({ path: testInfo.outputPath('email-sign-in-and-recovery.png') });
});

test('Administration invites an active employee with selected roles and no mobile field', async ({
  page,
}, testInfo) => {
  test.skip(hosted, 'Uses synthetic Administration responses');
  const actor = '00000000-0000-4000-8000-000000000001';
  const readyUser = '00000000-0000-4000-8000-000000000009';
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, exp })}.synthetic`;
  await page.addInitScript(
    ({ actor, token, exp }) =>
      localStorage.setItem(
        'sb-example-auth-token',
        JSON.stringify({
          access_token: token,
          refresh_token: 'synthetic',
          expires_at: exp,
          user: { id: actor, aud: 'authenticated', role: 'authenticated' },
        }),
      ),
    { actor, token, exp },
  );
  const commands = [];
  const saves = [];
  const lifecycle = [];
  let pending = true;
  let pendingEmail = 'pending@example.invalid';
  const originalRevision = '00000000-0000-4000-8000-000000000010';
  const newRevision = '00000000-0000-4000-8000-000000000011';
  let revision = originalRevision;
  let enabled = true;
  await page.route('https://example.invalid/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (name === 'erp-accounts') {
      const input = route.request().postDataJSON();
      commands.push(input);
      if (['retry', 'cancel'].includes(input.action)) pending = false;
      if (input.action === 'invite' && input.employeeId === '10') {
        pending = true;
        pendingEmail = input.email;
        revision = newRevision;
      }
      if (input.action === 'correct') pendingEmail = input.email;
      return route.fulfill({
        json: {
          message:
            {
              retry: 'Employee access linked.',
              cancel: 'Invitation cancelled.',
              correct: 'Invitation sent to the corrected email.',
            }[input.action] || 'Invitation sent.',
        },
      });
    }
    if (name === 'erp_save_account_access') {
      const input = route.request().postDataJSON();
      saves.push(input);
      enabled = input.p_enabled;
      return route.fulfill({ json: null });
    }
    if (name === 'erp_change_account_lifecycle') {
      const input = route.request().postDataJSON();
      lifecycle.push(input);
      enabled = input.p_action === 'reactivate';
      return route.fulfill({ json: null });
    }
    const responses = {
      erp_account_security: { enabled: true, ready: true },
      erp_access_snapshot: { actor, enabled: true, administrator: true },
      erp_admin_snapshot: {
        accounts: [
          {
            employee_id: '9',
            user_id: readyUser,
            name: 'Ready employee',
            is_active: enabled,
            version: 1,
            role_ids: ['2'],
          },
        ],
        auth_accounts: [{ id: readyUser, email: 'ready@example.invalid', mfa_enrolled: true }],
        pending_invitations: pending
          ? [{ employee_id: '10', email: pendingEmail, role_ids: ['2'], revision }]
          : [],
        audit: [
          {
            id: 1,
            action: 'Updated account access',
            actor_user_id: readyUser,
            target_id: readyUser,
            target_type: 'app_user',
            created_at: '2026-11-12T05:30:00Z',
          },
        ],
        employees: [
          { id: '7', name: 'Sample employee', employee_code: 'SCE/00007', is_active: true },
          { id: '8', name: 'Inactive employee', employee_code: 'SCE/00008', is_active: false },
          { id: '9', name: 'Ready employee', employee_code: 'SCE/00009', is_active: true },
          { id: '10', name: 'Pending employee', employee_code: 'SCE/00010', is_active: true },
        ],
        roles: [
          {
            id: '2',
            name: 'Production viewer',
            is_active: true,
            description: 'View production records',
          },
          {
            id: '3',
            name: 'Accounts viewer',
            is_active: true,
            description: 'View accounts records',
          },
        ],
        permissions: [],
        resources: [],
      },
    };
    return route.fulfill({ json: responses[name] ?? {} });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/access.html');
  await expect(page.getByRole('heading', { name: 'User Access' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Administration' })).toHaveCSS(
    'font-size',
    '29px',
  );
  await expect(page.getByRole('button', { name: 'Invite employee', exact: true })).toHaveCSS(
    'background-color',
    'rgb(53, 127, 183)',
  );
  await page.screenshot({
    path: testInfo.outputPath('administration-user-access.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Invite employee', exact: true }).click();
  await page.getByRole('combobox', { name: 'Select employee', exact: true }).click();
  await expect(page.getByRole('option', { name: /Inactive employee/ })).toHaveCount(0);
  await page.getByRole('option', { name: /Sample employee/ }).click();
  await page.getByLabel('Employee login email').fill('employee@example.invalid');
  await page.getByRole('checkbox', { name: 'Production viewer' }).check();
  await expect(page.getByLabel('Mobile number', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('administration-invitation.png') });
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invitation sent.', { exact: true })).toBeVisible();
  expect(commands[0]).toEqual({
    action: 'invite',
    employeeId: '7',
    email: 'employee@example.invalid',
    roleIds: ['2'],
  });
  await page.getByRole('combobox', { name: 'Filter access' }).selectOption('Needs attention');
  await expect(page.getByRole('row')).toHaveCount(2);
  const pendingRow = page.getByRole('row', { name: /Pending employee/ });
  await pendingRow.getByRole('button', { name: 'View details' }).click();
  await page.getByRole('button', { name: 'Cancel invitation' }).click();
  await expect(page.getByRole('dialog')).toContainText('will no longer grant ERP access');
  await page.screenshot({ path: testInfo.outputPath('administration-cancel-invitation.png') });
  await page.getByRole('button', { name: 'Go back' }).click();
  expect(commands).toHaveLength(1);
  await pendingRow.getByRole('button', { name: 'View details' }).click();
  await page.getByRole('button', { name: 'Cancel invitation' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel invitation' }).click();
  await expect(page.getByText('Invitation cancelled.', { exact: true })).toBeVisible();
  expect(commands[1]).toEqual({ action: 'cancel', employeeId: '10', revision: originalRevision });
  await expect(page.getByText('No employees match these filters.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Filter access' }).selectOption('');
  await pendingRow.getByRole('button', { name: 'Invite', exact: true }).click();
  await page.getByLabel('Employee login email').fill('pending@example.invalid');
  await page.getByRole('checkbox', { name: 'Production viewer' }).check();
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(pendingRow).toContainText('Needs attention');
  await page.getByRole('combobox', { name: 'Filter access' }).selectOption('Needs attention');
  await pendingRow.getByRole('button', { name: 'View details' }).click();
  await page.getByRole('button', { name: 'Correct email' }).click();
  await page.getByLabel('Employee login email').fill('corrected@example.invalid');
  await page.screenshot({ path: testInfo.outputPath('administration-correct-email.png') });
  await page.getByRole('button', { name: 'Send corrected invitation' }).click();
  await expect(pendingRow).toContainText('corrected@example.invalid');
  expect(commands[3]).toEqual({
    action: 'correct',
    employeeId: '10',
    email: 'corrected@example.invalid',
    revision: newRevision,
  });
  await page.getByRole('button', { name: 'Retry provisioning' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Retry provisioning' }).click();
  await expect(page.getByText('Employee access linked.', { exact: true })).toBeVisible();
  expect(commands[4]).toEqual({ action: 'retry', employeeId: '10', revision: newRevision });
  await expect(page.getByText('No employees match these filters.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Filter access' }).selectOption('');
  await page.getByRole('combobox', { name: 'Sort direction' }).selectOption('desc');
  await expect(page.getByRole('row').nth(1)).toContainText('Sample employee');
  await page.getByRole('searchbox', { name: 'Search users' }).fill('ready@example.invalid');
  const ready = page.getByRole('row', { name: /Ready employee/ });
  await expect(page.getByRole('row')).toHaveCount(2);
  await ready.getByRole('button', { name: 'View details' }).click();
  await page.getByRole('button', { name: 'Edit roles' }).click();
  await page.getByRole('checkbox', { name: 'Accounts viewer' }).check();
  await page.getByRole('button', { name: 'Save roles' }).click();
  await expect(page.getByText('Roles updated.', { exact: true })).toBeVisible();
  expect(saves[0].p_role_ids).toEqual(['2', '3']);
  await ready.getByRole('button', { name: 'View details' }).click();
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Review', exact: true }).click();
  expect(lifecycle).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Confirm Deactivate' }).click();
  await expect(ready).toContainText('Disabled');
  await ready.getByRole('button', { name: 'View details' }).click();
  await page.getByRole('button', { name: 'Reactivate', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm Reactivate' }).click();
  await expect(ready).toContainText('Enabled');
  expect(lifecycle.map((command) => [command.p_user_id, command.p_action])).toEqual([
    [readyUser, 'deactivate'],
    [readyUser, 'reactivate'],
  ]);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Roles & Permissions' }).click();
  await expect(main.getByRole('heading', { name: 'Roles', exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('administration-roles.png'),
    animations: 'disabled',
  });
  await main.getByRole('button', { name: 'Activity log' }).click();
  await expect(main.getByRole('heading', { name: 'Activity log' })).toBeVisible();
  await expect(main.getByRole('table')).toContainText('Updated account access');
  await expect(main.getByRole('table')).not.toContainText(actor);
  await page.screenshot({
    path: testInfo.outputPath('administration-activity.png'),
    animations: 'disabled',
  });
  await main.getByRole('button', { name: 'User Access' }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(main.getByRole('heading', { name: 'User Access' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({
    path: testInfo.outputPath('administration-mobile.png'),
    animations: 'disabled',
  });
});
