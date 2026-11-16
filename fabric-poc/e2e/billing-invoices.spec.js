import { test, expect } from '@playwright/test';

test('Billing invoice list filters, opens the shared sheet and loads invoice totals', async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(!['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname));
  const actor = '00000000-0000-4000-8000-000000000003';
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', aal: 'aal2', exp })}.synthetic`;
  await page.addInitScript(
    ({ token, actor, exp }) => {
      localStorage.setItem(
        'sb-example-auth-token',
        JSON.stringify({
          access_token: token,
          refresh_token: 'synthetic-refresh',
          expires_at: exp,
          expires_in: 3600,
          token_type: 'bearer',
          user: { id: actor, aud: 'authenticated', role: 'authenticated' },
        }),
      );
    },
    { token, actor, exp },
  );
  const record = {
    id: '120',
    invoice_number: 'INV-2026-046',
    invoice_date: '2026-11-12',
    buyer: 'Threadline Retail',
    po_number: 'PO-2026-008',
    mode: 'standard',
    status: 'dispatched',
    original_value: 300,
    verified_credit: 100,
  };
  let allowed = true;
  let invoicePreferences = {};
  await page.route('https://example.invalid/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    const args = route.request().postDataJSON();
    if (name === 'erp_grid_preferences' && args?.p_grid === 'overview-billing-invoices') {
      invoicePreferences = { ...invoicePreferences, ...args.p_patch };
    }
    const responses = {
      erp_contacts_workspace: {},
      erp_account_security: { enabled: true, ready: true },
      erp_access_snapshot: {
        actor,
        enabled: true,
        permissions: {
          billingInvoices: { view: allowed },
          finishedProducts: { view: allowed },
          employees: { view: allowed },
          materialContacts: { view: allowed },
        },
      },
      erp_grid_preferences: args?.p_grid === 'overview-billing-invoices' ? invoicePreferences : {},
      erp_portal_invoice_list:
        (!args?.p_status || args.p_status === record.status) &&
        (!args?.p_search || record.invoice_number.includes(args.p_search))
          ? [record]
          : [],
      erp_portal_invoice: {
        invoice: record,
        buyer: record.buyer,
        status: record.status,
        mode: record.mode,
        po_number: record.po_number,
        totals: {
          original_value: 300,
          verified_credit: 100,
          taxable_value: 200,
          gst_amount: 10,
          total_including_gst: 210,
        },
      },
    };
    if (!Object.hasOwn(responses, name)) throw Error(`Unexpected Billing request: ${name}`);
    await route.fulfill({ json: responses[name] });
  });

  await page.goto('/fabric.html?live=1#billingInvoices');
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible();
  const sidebarOrder = await page
    .locator('#workspace-sidebar [data-nav-section]')
    .evaluateAll((sections) => sections.map((section) => section.dataset.navSection));
  expect(sidebarOrder.indexOf('finished-goods')).toBeGreaterThanOrEqual(0);
  expect(sidebarOrder.indexOf('billing')).toBe(sidebarOrder.indexOf('finished-goods') + 1);
  expect(sidebarOrder.indexOf('miscellaneous')).toBeGreaterThanOrEqual(0);
  expect(sidebarOrder.indexOf('hr')).toBe(sidebarOrder.indexOf('miscellaneous') + 1);
  await expect(page.getByRole('button', { name: 'New invoice' })).toHaveCount(0);

  const rowLink = page.getByRole('button', { name: record.invoice_number });
  await expect(rowLink).toBeVisible();
  await page.getByRole('combobox', { name: 'Invoice status' }).selectOption('draft');
  await expect(rowLink).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Invoice status' }).selectOption('dispatched');
  await expect(rowLink).toBeVisible();
  const scrollRegion = page.getByRole('region', { name: 'Invoices', exact: true });
  await expect(scrollRegion).toHaveAttribute('tabindex', '0');
  const buyer = page.getByRole('columnheader', { name: 'Buyer' });
  await buyer.getByRole('button', { name: 'Buyer' }).click();
  await expect(buyer).toHaveAttribute('aria-sort', 'ascending');

  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  const filters = page.getByRole('dialog', { name: 'Filter' });
  await filters.getByRole('button', { name: '+ Add filter rule' }).click();
  await filters.getByLabel('Filter field 1').selectOption('buyer');
  await filters.getByLabel('Filter value 1').fill('Missing buyer');
  await filters.getByRole('button', { name: 'Close' }).click();
  await expect(rowLink).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(rowLink).toBeVisible();

  await page.getByRole('button', { name: 'Group', exact: true }).click();
  const groups = page.getByRole('dialog', { name: 'Group' });
  await groups.getByRole('button', { name: '+ Add grouping level' }).click();
  await groups.getByLabel('Group field 1').selectOption('status');
  await groups.getByRole('button', { name: 'Close' }).click();
  const statusGroup = page.getByRole('button', { name: /Dispatched · 1/ });
  await expect(statusGroup).toBeVisible();
  await statusGroup.click();
  await expect(rowLink).toBeVisible();

  await page.getByRole('button', { name: 'Columns' }).click();
  const columns = page.getByRole('dialog', { name: 'Columns' });
  await columns.getByRole('checkbox', { name: 'Sale mode' }).check();
  await columns.getByRole('spinbutton', { name: 'Buyer width in pixels' }).fill('240');
  await columns.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('columnheader', { name: 'Sale mode' })).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Search invoice number, buyer or PO' });
  await search.fill('INV-2026-046');
  await expect.poll(() => invoicePreferences.search).toBe('INV-2026-046');
  await page.reload();
  await expect(search).toHaveValue('INV-2026-046');
  await expect(page.getByRole('columnheader', { name: 'Sale mode' })).toBeVisible();
  expect(invoicePreferences.columnWidths).toMatchObject({ buyer: 240 });
  await expect(buyer).toHaveAttribute('aria-sort', 'ascending');
  await expect(rowLink).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('invoice-overview.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Hide menu' }).click();
  await expect(scrollRegion).toBeVisible();
  expect(await scrollRegion.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: testInfo.outputPath('invoice-overview-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole('button', { name: 'Sheet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sheet', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('Sort complete rows by')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('invoice-sheet.png') });
  await page
    .getByRole('group', { name: 'Invoices view' })
    .getByRole('button', { name: 'Overview' })
    .click();
  await page.getByRole('cell', { name: record.buyer }).click();
  await expect(page.getByRole('heading', { name: record.invoice_number })).toBeVisible();
  await expect(page.getByText('₹210.00')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('invoice-detail.png') });

  allowed = false;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Invoices access restricted' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Billing pages' })).toHaveCount(0);
});
