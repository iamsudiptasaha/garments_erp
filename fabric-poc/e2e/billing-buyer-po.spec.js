import { test, expect } from '@playwright/test';

test('Buyer PO entry saves mixed modes with a protected recipe and opens the saved detail', async ({
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
  const standard = { id: '1', style: 'Top', size: 'S', weight: 2 };
  const exception = { id: '2', style: 'Pant', size: 'M' };
  const records = [];
  let saved;
  await page.route('https://example.invalid/**', async (route) => {
    const method = new URL(route.request().url()).pathname.split('/').at(-1);
    const args = route.request().postDataJSON();
    const responses = {
      erp_account_security: { enabled: true, ready: true },
      erp_access_snapshot: {
        actor,
        enabled: true,
        permissions: { billingBuyerPO: { view: true, create: true } },
      },
      erp_grid_preferences: {},
      erp_portal_buyer_po: records,
      erp_portal_buyer_po_choices: {
        buyers: [{ id: '9', name: 'Retail buyer' }],
        products: [{ id: '7', name: 'Test set', sku: 'TEST', pieces: [standard] }],
        sizes: [exception],
      },
      erp_portal_create_buyer_po: '22',
    };
    if (method === 'erp_portal_create_buyer_po') {
      saved = args.p_order;
      records.push({
        id: '22',
        po_number: saved.number,
        buyer: 'Retail buyer',
        issue_date: saved.issue_date,
        modes: 'Exception, Standard',
        line_count: 2,
        lines: [
          {
            id: '5',
            mode: 'standard',
            product: 'Test set',
            unit_price: 200,
            pieces: [{ ...standard, ordered: 6, remaining: 6, hsn: '06204' }],
          },
          {
            id: '6',
            mode: 'exception',
            pieces: [{ ...exception, ordered: 1, remaining: 1, price: 40 }],
          },
        ],
      });
    }
    if (['erp_file_registry', 'erp_file_routes', 'erp_file_list'].includes(method)) {
      await route.fulfill({ json: [] });
      return;
    }
    if (!Object.hasOwn(responses, method)) throw Error(`Unexpected Buyer PO request: ${method}`);
    await route.fulfill({ json: responses[method] });
  });

  await page.goto('/fabric.html?live=1#billingBuyerPO');
  await expect(page.getByRole('cell', { name: 'No matching records' })).toBeVisible();
  await page.getByRole('button', { name: 'New buyer PO' }).click();
  const dialog = page.getByRole('dialog', { name: 'New buyer PO' });
  await dialog.getByLabel('PO number').fill('PO-MIXED');
  await dialog.getByLabel('Buyer', { exact: true }).selectOption('9');
  await dialog.getByLabel('Issue date').fill('2026-11-12');
  await dialog.getByLabel('ERP item / sellable product').selectOption('7');
  await dialog.getByLabel('Ordered sets').fill('3');
  await dialog.getByLabel('PO unit price').fill('200');
  await dialog.getByLabel('HSN code · Top · S').fill('06204');
  await expect(dialog.getByRole('cell', { name: '2', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add PO item' }).click();
  const second = dialog.locator('section.fabric-line').filter({
    has: page.getByRole('heading', { name: 'PO item 2', exact: true }),
  });
  await second.getByLabel('Sale mode').selectOption('exception');
  await second.getByLabel('ERP item / sellable product').selectOption('2');
  await second.getByLabel('Ordered pieces').fill('1');
  await second.getByLabel('PO unit price').fill('40');
  await page.screenshot({ path: testInfo.outputPath('buyer-po-entry.png') });
  await dialog.getByRole('button', { name: 'Review buyer PO' }).click();
  await expect(dialog.getByRole('region', { name: 'Review buyer PO' })).toContainText('PO-MIXED');
  expect(saved).toBeUndefined();
  await dialog.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page.getByRole('heading', { name: 'PO-MIXED' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '06204' })).toBeVisible();
  expect(saved.lines).toMatchObject([
    { mode: 'standard', quantity: 3, sellable_product_id: '7' },
    { mode: 'exception', quantity: 1, size_id: '2' },
  ]);
  expect(saved.lines[0]).not.toHaveProperty('share_weight');
  await page.screenshot({ path: testInfo.outputPath('buyer-po-detail.png') });
  await page.getByRole('button', { name: 'Back to Buyer PO' }).click();
  await expect(page.getByRole('button', { name: 'PO-MIXED' })).toBeVisible();
  await page
    .getByRole('group', { name: 'Buyer PO view' })
    .getByRole('button', { name: 'Sheet' })
    .click();
  await expect(page.getByRole('button', { name: 'Open selected document' })).toBeDisabled();
  await expect(page.getByText('Sort complete rows by')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('buyer-po-sheet.png') });
});
