import { test, expect } from '@playwright/test';

test('signed-in Inventory saves a receipt and issues stock against the saved receipt', async ({
  page,
  baseURL,
}) => {
  test.skip(!['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname));
  const actor = '00000000-0000-4000-8000-000000000003';
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', aal: 'aal2', exp })}.synthetic`;
  await page.addInitScript(
    ({ token, actor, exp }) =>
      localStorage.setItem(
        'sb-example-auth-token',
        JSON.stringify({
          access_token: token,
          refresh_token: 'synthetic-refresh',
          expires_at: exp,
          expires_in: 3600,
          token_type: 'bearer',
          user: {
            id: actor,
            email: 'operator@example.invalid',
            aud: 'authenticated',
            role: 'authenticated',
          },
        }),
      ),
    { token, actor, exp },
  );
  const stock = {
    raw_material_check_in: [],
    raw_material_check_out: [],
    raw_material_item: [{ id: '7', name: 'Cotton tape', unit_of_measure_id: '9' }],
    raw_material_purchase_order: [
      { id: '4', purchase_order_number: 'RM-4', raw_material_supplier_list_id: '8' },
    ],
    raw_material_purchase_order_item: [
      { id: '12', raw_material_purchase_order_id: '4', raw_material_item_id: '7', quantity: 10 },
    ],
    raw_material_supplier_list: [{ id: '8', contacts_id: '10' }],
    contacts: [{ id: '10', company_name: 'Tape Supplier' }],
    unit_of_measure: [{ id: '9', unit: 'metres' }],
    check_out_type: [{ id: '11', name: 'Production' }],
    employee: [],
  };
  const calls = [];
  await page.route('https://example.invalid/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    const args = route.request().postDataJSON();
    let body;
    if (name === 'erp_account_security') body = { enabled: true, ready: true };
    else if (name === 'erp_access_snapshot')
      body = {
        actor,
        enabled: true,
        administrator: false,
        permissions: Object.fromEntries(
          ['materialReceipts', 'materialIssues', 'materialStock'].map((key) => [
            key,
            { view: true, create: true, edit: true },
          ]),
        ),
      };
    else if (name === 'erp_raw_material_transaction_snapshot') body = stock;
    else if (name === 'erp_save_raw_material_transaction') {
      calls.push(args);
      if (args.p_resource === 'materialReceipts') {
        body = { id: '21', sku: 'RCV-21', ...args.p_values };
        stock.raw_material_check_in.push(body);
      } else {
        body = { id: '22', ...args.p_values };
        stock.raw_material_check_out.push(body);
      }
    } else throw Error(`Unexpected Inventory request: ${name}`);
    await route.fulfill({ json: body });
  });

  await page.goto('/fabric.html?live=1#materialReceipts');
  await page.getByRole('button', { name: '+ Receive stock' }).click();
  await page.getByLabel('Purchase order', { exact: true }).selectOption('4');
  await page.getByLabel('Purchase order line', { exact: true }).selectOption('12');
  await page.getByLabel('Billed quantity').fill('10');
  await page.getByRole('button', { name: 'Review details →' }).click();
  await page.getByRole('button', { name: 'Confirm & save', exact: true }).click();
  await expect(page.getByText('RCV-21', { exact: true }).first()).toBeVisible();
  expect(calls[0].p_values.raw_material_purchase_order_item_id).toBe('12');

  await page.goto('/fabric.html?live=1#materialIssues');
  await page.getByRole('button', { name: '+ Record outward' }).click();
  await page.getByLabel('Source receipt / stock').selectOption('21');
  await page.getByLabel('Outward quantity').fill('4');
  await page.getByLabel('Outward type').selectOption('11');
  await page.getByRole('button', { name: 'Review details →' }).click();
  await page.getByRole('button', { name: 'Confirm & save', exact: true }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].p_values).toMatchObject({ raw_material_check_in_id: '21', quantity: 4 });
});
