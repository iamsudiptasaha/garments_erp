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
}) => {
  test.skip(hosted, 'Hosted smoke tests do not submit login credentials');
  const id = '00000000-0000-4000-8000-000000000003';
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = [
    part({ alg: 'HS256', typ: 'JWT' }),
    part({ sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }),
    'synthetic_test_signature',
  ].join('.');
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
    else if (url.includes('erp_account_security'))
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
    '/access.html',
  );
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
}) => {
  test.skip(hosted, 'Hosted smoke tests never change employees');
  await page.goto('/fabric.html#employees');
  const card = page.locator('.hr-person-card').first();
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: /^Deactivate / })).toHaveCount(0);
  await card.getByRole('button', { name: 'Open profile →' }).click();
  const statusDialog = page.getByRole('dialog');
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
