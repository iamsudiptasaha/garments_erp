import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { totp } from '../integration/billing-totp.mjs';

test('local Supabase Billing workflow from Buyer PO through stock restoration', async ({
  page,
}, testInfo) => {
  const host = process.env.BILLING_TEST_HOST;
  const secret = process.env.BILLING_TEST_SECRET;
  test.skip(!host || !secret, 'Requires the disposable Billing Supabase test runner');
  expect(host).toMatch(/^127\.0\.0\.1:[0-9]+$/);
  const authHost = process.env.BILLING_AUTH_HOST;
  if (!authHost) {
    const sub = '00000000-0000-4000-8000-000000000001';
    const exp = Math.floor(Date.now() / 1000) + 300;
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const data = [
      encode({ alg: 'HS256', typ: 'JWT' }),
      encode({
        sub,
        role: 'authenticated',
        aal: 'aal2',
        exp,
        session_id: '10000000-0000-4000-8000-000000000001',
      }),
    ].join('.');
    const access_token = data + '.' + createHmac('sha256', secret).update(data).digest('base64url');
    await page.addInitScript(
      ({ sub, exp, access_token }) => {
        localStorage.setItem(
          'sb-example-auth-token',
          JSON.stringify({
            access_token,
            refresh_token: 'local-fixture',
            expires_at: exp,
            token_type: 'bearer',
            user: { id: sub, aud: 'authenticated', role: 'authenticated' },
          }),
        );
      },
      { sub, exp, access_token },
    );
  }
  await page.route('https://example.invalid/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: 'http://' + host + url.pathname.replace('/rest/v1', '') + url.search,
    });
    await route.fulfill({ response });
  });

  if (authHost) {
    test.setTimeout(75_000);
    expect(authHost).toMatch(/^127\.0\.0\.1:[0-9]+$/);
    const fixture = JSON.parse(readFileSync(process.env.BILLING_AUTH_BROWSER_FIXTURE, 'utf8'));
    await page.route('https://example.invalid/auth/v1/**', async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        response: await route.fetch({
          url: 'http://' + authHost + url.pathname.replace('/auth/v1', '') + url.search,
        }),
      });
    });
    await page.goto('/access.html');
    await page.getByLabel('Email', { exact: true }).fill(fixture.email);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Google Authenticator' })).toBeVisible();
    await expect
      .poll(() => Math.floor(Date.now() / 30000), {
        timeout: 32_000,
        intervals: [250, 500, 1000],
      })
      .not.toBe(fixture.step);
    await page.getByLabel('Authenticator code').fill(totp(fixture.secret));
    await page.getByRole('button', { name: 'Verify authenticator' }).click();
    await expect(page).toHaveURL(/fabric\.html\?live=1/);
  }

  const nav = page.getByRole('navigation', { name: 'Billing pages' });
  const snapshot = (name) => page.screenshot({ path: testInfo.outputPath(name + '.png') });
  const getByButton = (name) => page.getByRole('button', { name, exact: true });
  await page.goto('/fabric.html?live=1#billingBuyerPO');
  const orderView = page.getByRole('group', { name: 'Buyer PO view' });
  await expect(orderView).toHaveCSS('border-radius', '9px');
  await expect(page.getByRole('columnheader', { name: 'PO number' })).toBeVisible();
  await snapshot('buyer-po-overview');
  await getByButton('New buyer PO').click();
  const buyerPO = page.getByRole('dialog', { name: 'New buyer PO' });
  await buyerPO.getByLabel('PO number').fill('BROWSER-MIXED-PO');
  await buyerPO.getByLabel('Buyer', { exact: true }).selectOption('982001');
  await buyerPO.getByLabel('Issue date').fill('2026-11-12');
  await buyerPO.getByLabel('ERP item / sellable product').selectOption('982001');
  await buyerPO.getByLabel('Ordered sets').fill('1');
  await buyerPO.getByLabel('PO unit price').fill('115');
  await buyerPO.getByRole('button', { name: 'Add PO item' }).click();
  const exception = buyerPO.locator('.fabric-line').last();
  await exception.getByLabel('Sale mode').selectOption('exception');
  await exception.getByLabel('ERP item / sellable product').selectOption('982001');
  await exception.getByLabel('Ordered pieces').fill('3');
  await exception.getByLabel('PO unit price').fill('40');
  await snapshot('buyer-po-editor');
  await buyerPO.getByRole('button', { name: 'Save buyer PO' }).click();
  await expect(page.getByRole('heading', { name: 'BROWSER-MIXED-PO' })).toBeVisible();
  await snapshot('buyer-po-real');

  for (const [number, quantity] of [
    ['BROWSER-PARTIAL-1', '2'],
    ['BROWSER-PARTIAL-2', '1'],
  ]) {
    await getByButton('Create invoice').click();
    await expect(page.getByRole('heading', { name: 'New invoice' })).toBeVisible();
    await page.getByLabel('Invoice date', { exact: true }).fill('2026-11-12');
    await page.getByLabel('Invoice number', { exact: true }).fill(number);
    await page.getByLabel('GST %', { exact: true }).fill('5');
    await page.getByLabel('Sale mode', { exact: true }).selectOption('exception');
    await getByButton('Add invoice line').click();
    const poItem = page.getByLabel('PO item', { exact: true });
    await expect(poItem.getByRole('option')).toHaveCount(2);
    await poItem.selectOption({ index: 1 });
    await page.getByLabel('Billed pieces · Billing test S').fill(quantity);
    await page.getByLabel('Invoice price · Billing test S').fill(quantity === '2' ? '39' : '40');
    if (quantity === '2') {
      await expect(page.getByRole('region', { name: 'Invoice totals' })).toContainText('₹81.90');
      await snapshot('formal-invoice-editor');
      await getByButton('Save draft').click();
      await expect(page.getByRole('heading', { name: number })).toBeVisible();
      await getByButton('Edit draft').click();
      const editor = page.getByRole('dialog', { name: 'Edit invoice' });
      await expect(editor.getByLabel('Invoice price · Billing test S')).toHaveValue('39');
      await editor.getByLabel('Invoice price · Billing test S').fill('40');
    }
    await getByButton('Finalize invoice').click();
    await expect(page.getByRole('heading', { name: number })).toBeVisible();
    await expect(getByButton('Create packing list')).toBeVisible();
    if (quantity === '2') {
      await nav.getByRole('button', { name: 'Buyer PO', exact: true }).click();
      await getByButton('BROWSER-MIXED-PO').click();
    }
  }

  await getByButton('Back to invoices').click();
  await expect(page.getByRole('columnheader', { name: 'Verified credits' })).toBeVisible();
  await snapshot('invoices-overview');
  await getByButton('BROWSER-PARTIAL-1').click();
  await getByButton('Create packing list').click();
  const packing = page.getByRole('dialog', { name: 'Create packing list' });
  await packing.getByLabel('Packing date').fill('2026-11-12');
  await packing.getByLabel('Location').fill('KOL');
  await packing.getByRole('button', { name: 'Create packing list' }).click();
  await expect(page.getByRole('button', { name: /^PL-/ })).toBeVisible();

  await nav.getByRole('button', { name: 'Packing Lists', exact: true }).click();
  const packingRow = page.getByRole('row').filter({ hasText: 'BROWSER-PARTIAL-1' });
  await expect(page.locator('.billing-table-frame')).toHaveCSS('border-radius', '10px');
  await snapshot('packing-overview');
  await packingRow.getByRole('button', { name: /^PL-/ }).click();
  const packingDetails = page.getByRole('dialog', { name: 'Packing list details' });
  await expect(packingDetails.getByText('No cartons assigned.')).toBeVisible();
  await snapshot('packing-list');
  await packingDetails.getByRole('button', { name: 'Close' }).click();

  await nav.getByRole('button', { name: 'Cartons', exact: true }).click();
  await getByButton('Add carton').click();
  const carton = page.getByRole('dialog', { name: 'Add carton' });
  const option = carton.getByRole('option', { name: /BROWSER-PARTIAL-1/ });
  await expect(option).toHaveCount(1);
  await carton.getByLabel('Packing list').selectOption(await option.getAttribute('value'));
  await carton.getByLabel('Barcode').fill('BROWSER-CTN');
  await carton.getByLabel(/Pack quantity for/).fill('2');
  await snapshot('carton-editor');
  await carton.getByRole('button', { name: 'Save carton' }).click();
  const savedCarton = page.getByRole('row').filter({ hasText: 'BROWSER-PARTIAL-1' });
  await expect(savedCarton.getByRole('button', { name: 'Delete' })).toBeVisible();
  await savedCarton.getByRole('button', { name: /^PL-/ }).click();
  await expect(page.getByRole('dialog', { name: 'Packing list details' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Packing list details' })
    .getByRole('button', { name: 'Close' })
    .click();
  await snapshot('cartons-overview');

  await nav.getByRole('button', { name: 'Dispatch / Transport', exact: true }).click();
  await getByButton('New transport').click();
  const transport = page.getByRole('dialog', { name: 'New transport' });
  await transport.getByLabel('Carrier').selectOption('982001');
  await transport.getByLabel('Docket number').fill('BROWSER-DOCKET');
  await transport.getByLabel('Pickup date').fill('2026-11-12');
  await transport.getByRole('checkbox', { name: /BROWSER-PARTIAL-1/ }).check();
  await transport.getByRole('button', { name: 'Save transport' }).click();
  const dispatch = page.getByRole('row').filter({ hasText: 'BROWSER-DOCKET' });
  await dispatch.getByRole('button', { name: 'Confirm pickup' }).click();
  await page
    .getByRole('dialog', { name: 'Confirm pickup' })
    .getByRole('button', { name: 'Dispatch cartons' })
    .click();
  await expect(dispatch.getByText('Dispatched')).toBeVisible();
  await snapshot('dispatch');
  await dispatch.getByRole('button', { name: /^TR-/ }).click();
  const assigned = page.getByRole('heading', { name: 'Assigned cartons' }).locator('..');
  await assigned.getByRole('button', { name: /^KOL-/ }).click();
  const shippedCarton = page.getByRole('dialog', { name: /^KOL-/ });
  await expect(shippedCarton.getByRole('cell', { name: '2', exact: true })).toBeVisible();
  await shippedCarton.getByRole('button', { name: 'Close' }).click();
  await nav.getByRole('button', { name: 'Cartons', exact: true }).click();
  const dispatchedCarton = page.getByRole('row').filter({ hasText: 'BROWSER-PARTIAL-1' });
  await expect(dispatchedCarton.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await dispatchedCarton.getByRole('button', { name: /^TR-/ }).click();
  await expect(page.getByRole('heading', { name: 'Assigned cartons' })).toBeVisible();

  await nav.getByRole('button', { name: 'Billing Summary', exact: true }).click();
  const stock = page.getByRole('row').filter({ hasText: 'Billing test S' });
  await expect(stock.getByRole('cell').last()).toHaveText('5');
  await nav.getByRole('button', { name: 'Returns', exact: true }).click();
  await getByButton('Record return').click();
  const ret = page.getByRole('dialog', { name: 'Record return' });
  await ret
    .getByLabel('Dispatched invoice')
    .selectOption({ label: 'BROWSER-PARTIAL-1 · Billing test buyer' });
  await ret.getByLabel(/Pieces for/).fill('1');
  await ret.getByLabel(/Price for/).fill('20');
  await snapshot('piece-return');
  await ret.getByRole('button', { name: 'Verify return' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'BROWSER-PARTIAL-1' })).toBeVisible();
  await snapshot('returns-overview');
  await getByButton('BROWSER-PARTIAL-1').click();
  await expect(page.getByText('₹63.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Verified returns' })).toBeVisible();
  await snapshot('invoice-detail');
  await getByButton('Record return').click();
  const invoiceReturn = page.getByRole('dialog', { name: 'Record return' });
  await expect(invoiceReturn.getByLabel('Dispatched invoice')).toBeDisabled();
  await invoiceReturn.getByRole('button', { name: 'Close' }).click();
  await nav.getByRole('button', { name: 'Billing Summary', exact: true }).click();
  await expect(stock.getByRole('cell').last()).toHaveText('6');
  await snapshot('billing-summary');
  const summaryView = page.getByRole('group', { name: 'Billing Summary view' });
  const cards = page.locator('.overview-grid');
  const visual = { animations: 'disabled', caret: 'hide' };
  const before = await cards.screenshot(visual);
  await summaryView.getByRole('button', { name: 'Sheet', exact: true }).click();
  await expect(page.getByText('Sort complete rows by')).toBeVisible();
  await summaryView.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.mouse.move(0, 0);
  expect(await cards.screenshot(visual)).toEqual(before);

  await nav.getByRole('button', { name: 'Invoices', exact: true }).click();
  await getByButton('New invoice').click();
  const adhoc = page.getByRole('form', { name: 'Invoice editor' });
  await adhoc.getByLabel('Billing source').selectOption('adhoc');
  await adhoc.getByLabel('Buyer', { exact: true }).selectOption('982001');
  await adhoc.getByLabel('Sale mode').selectOption('standard');
  await adhoc.getByLabel('Invoice date').fill('2026-11-12');
  await adhoc.getByLabel('Invoice number', { exact: true }).fill('BROWSER-ADHOC-DRAFT');
  await adhoc.getByLabel('GST %', { exact: true }).fill('5');
  await adhoc.getByRole('button', { name: 'Add invoice line' }).click();
  await adhoc.getByLabel('ERP item / sellable product').selectOption('982001');
  await adhoc.getByLabel('Product type').selectOption('982001');
  await adhoc.getByLabel('Billed sets').fill('1');
  await adhoc.getByLabel('Invoice price per set').fill('120');
  await adhoc.getByLabel('HSN · Billing test S').fill('06204');
  await snapshot('ad-hoc-invoice-editor');
  await adhoc.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { name: 'BROWSER-ADHOC-DRAFT' })).toBeVisible();
  await getByButton('Back to invoices').click();
  await page
    .getByRole('searchbox', { name: 'Search invoice number, buyer or PO' })
    .fill('BROWSER-ADHOC-DRAFT');
  await expect(getByButton('BROWSER-ADHOC-DRAFT')).toBeVisible();
  await page
    .getByRole('group', { name: 'Invoices view' })
    .getByRole('button', { name: 'Sheet' })
    .click();
  const editSelected = getByButton('Edit selected document');
  await expect(editSelected).toBeDisabled();
  await page.locator('.fortune-sheet-overlay').click({ position: { x: 85, y: 82 } });
  await editSelected.click();
  const edit = page.getByRole('dialog', { name: 'Edit invoice' });
  await expect(edit.getByLabel('Invoice number', { exact: true })).toHaveValue(
    'BROWSER-ADHOC-DRAFT',
  );
  await expect(edit.getByLabel('HSN · Billing test S')).toHaveValue('06204');
  await edit.getByRole('button', { name: 'Finalize invoice' }).click();
  await expect(page.getByRole('heading', { name: 'BROWSER-ADHOC-DRAFT' })).toBeVisible();
  await expect(getByButton('Create packing list')).toBeVisible();
});
