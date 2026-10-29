import { test, expect } from '@playwright/test';
const hosted = !!process.env.E2E_BASE_URL;
test('portable root has a usable landing page or production sign-in', async ({ page }) => {
  await page.goto('/');
  if (hosted) {
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByLabel('Mobile number', { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Documents by section' })).toBeVisible();
  }
});
test('direct sign-in entry remains accessible', async ({ page }) => {
  await page.goto('/access.html');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Administrator email sign-in' })).toBeVisible();
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
  await expect(page.getByLabel('Version date', { exact: true })).toBeEnabled();
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
    else if (url.includes('erp_access_snapshot'))
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
  await page.getByLabel('Mobile number', { exact: true }).fill('9000000000');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
});
