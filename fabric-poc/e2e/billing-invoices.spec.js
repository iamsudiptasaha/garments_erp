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
  await page.route('https://example.invalid/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    const args = route.request().postDataJSON();
    const responses = {
      erp_account_security: { enabled: true, ready: true },
      erp_access_snapshot: {
        actor,
        enabled: true,
        permissions: { billingInvoices: { view: allowed } },
      },
      erp_grid_preferences: {},
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
  const rowLink = page.getByRole('button', { name: record.invoice_number });
  await expect(rowLink).toBeVisible();
  await page.getByRole('combobox', { name: 'Invoice status' }).selectOption('draft');
  await expect(page.getByText('No invoices found.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Invoice status' }).selectOption('dispatched');
  await expect(rowLink).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('invoice-overview.png') });

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
  await rowLink.click();
  await expect(page.getByRole('heading', { name: record.invoice_number })).toBeVisible();
  await expect(page.getByText('₹210.00')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('invoice-detail.png') });

  allowed = false;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Invoices access restricted' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Billing pages' })).toHaveCount(0);
});
