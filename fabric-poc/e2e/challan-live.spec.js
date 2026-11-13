import { expect, test } from '@playwright/test';

const endpoint = 'http://127.0.0.1:55431';
const token = process.env.CHALLAN_TEST_TOKEN;
const key = process.env.CHALLAN_TEST_KEY;
const actor = process.env.CHALLAN_TEST_ACTOR || '00000000-0000-4000-8000-000000000001';

test('authenticated Challan and Worker Bill CRUD with real Supabase', async ({ page, request }) => {
  test.skip(!token || !key, 'Requires the isolated Supabase Challan fixture on port 55431');
  const errors = [];
  const invoice = 'E2E-' + Date.now();
  const editedInvoice = invoice + '-EDITED';
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ token, actor }) => {
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem(
        'sb-example-auth-token',
        JSON.stringify({
          access_token: token,
          refresh_token: 'test-session',
          expires_at: expiry,
          expires_in: 3600,
          token_type: 'bearer',
          user: { id: actor, aud: 'authenticated', role: 'authenticated' },
        }),
      );
    },
    { token, actor },
  );
  // The production browser config requires HTTPS. Bridge only the test origin
  // to the real localhost gateway without mocking any Supabase responses.
  await page.route('https://example.invalid/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: endpoint + url.pathname + url.search,
      headers: { ...route.request().headers(), apikey: key },
    });
    await route.fulfill({ response });
  });
  const rpc = (name, data) =>
    request.post(endpoint + '/rest/v1/rpc/' + name, {
      headers: { apikey: key, Authorization: 'Bearer ' + token },
      data,
    });
  const read = async (billing) => {
    const response = await rpc('erp_challan_documents', { p_billing: billing });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const save = (billing, action, document) =>
    rpc('erp_save_challan_document', {
      p_billing: billing,
      p_action: action,
      p_document: document,
    });

  const line = { assignment: '974001', quantities: { 'Test S': '24', 'Test M': '8' } };
  const concurrentIssues = await Promise.all(
    [1, 2].map(() => save(false, 'create', { lines: [line] })),
  );
  for (const result of concurrentIssues) expect(result.ok(), await result.text()).toBeTruthy();
  const keys = await Promise.all(concurrentIssues.map((result) => result.json()));
  expect(new Set(keys).size).toBe(2);
  const issued = (await read(false)).challans.filter((record) => keys.includes(record.key));
  expect(issued.map((record) => record.lines[0].quantities)).toEqual([
    line.quantities,
    line.quantities,
  ]);

  await page.goto('/fabric.html?live=1');
  await page.getByRole('link', { name: 'Challans', exact: true }).click();
  await expect(page).toHaveURL(/production-challan[.]html#challans$/);
  await page.getByRole('button', { name: '+ New challan' }).click();
  const description = page.getByLabel('Description').first();
  const descriptionNode = await description.elementHandle();
  await page.getByLabel('Job worker').selectOption('974001');
  await description.fill('Draft survives editing job lines');
  await page.getByRole('button', { name: 'Add job line' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).last().click();
  await expect(description).toHaveValue('Draft survives editing job lines');
  expect(await description.evaluate((node, original) => node === original, descriptionNode)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Select job variant' }).click();
  await page.getByRole('searchbox', { name: 'Search job variants' }).fill('CHALLAN-TEST');
  await page.getByRole('button', { name: /Select CHALLAN-TEST.*TEST-JOB/ }).click();
  await expect(page.getByRole('cell', { name: '24', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '8', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save challan' }).click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('button', { name: 'Edit challan' })).toBeVisible();
  const challanNumber = await detail.locator('h2').first().textContent();
  await detail.getByRole('button', { name: 'Edit challan' }).click();
  await page.getByLabel('Description').fill('E2E full issue');
  await page.getByRole('button', { name: 'Save challan' }).click();
  await expect(detail.getByText('E2E full issue')).toBeVisible();
  await detail.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('link', { name: 'Worker bills' }).click();
  await page.getByRole('button', { name: '+ New worker bill' }).click();
  await page.getByLabel('Job worker').selectOption('974001');
  await page.getByLabel('Invoice number').fill(invoice);
  await page.getByLabel('Bill date').fill('2026-11-11');
  if (process.env.CHALLAN_TEST_FILES) {
    await page.getByLabel('Bill attachment').setInputFiles({
      name: 'worker-bill.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% Synthetic invoice fixture\n%%EOF'),
    });
  }
  for (const number of [challanNumber, issued[0].id]) {
    await page.getByRole('button', { name: '+ Select challan item' }).click();
    await page.getByRole('searchbox', { name: 'Search challan items' }).fill(number);
    await page.getByRole('button', { name: new RegExp('Select ' + number + ' ·') }).click();
  }
  await page.getByLabel('Billed price for item 1').fill('3');
  await page.getByLabel('Billed price for item 2').fill('4');
  await page.getByRole('button', { name: 'Review worker bill' }).click();
  await page.getByRole('button', { name: 'Confirm save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New worker bill' })).toBeHidden();
  await page.getByRole('button', { name: new RegExp(invoice) }).click();
  await expect(detail.getByRole('cell', { name: challanNumber, exact: true })).toBeVisible();
  await expect(detail.getByRole('cell', { name: issued[0].id, exact: true })).toBeVisible();
  let attachmentId;
  if (process.env.CHALLAN_TEST_FILES) {
    await expect(detail.getByRole('button', { name: 'worker-bill.pdf' })).toBeVisible();
    const bill = (await read(true)).bills.find((row) => row.invoiceNumber === invoice);
    expect(bill.attachment.name).toBe('worker-bill.pdf');
    attachmentId = bill.attachment.id;
    const link = await request.post(endpoint + '/functions/v1/erp-files', {
      headers: { apikey: key, Authorization: 'Bearer ' + token },
      data: { action: 'read', attachmentId },
    });
    expect(link.ok(), await link.text()).toBeTruthy();
    // The local edge runtime signs against Docker's internal gateway hostname.
    const signed = new URL((await link.json()).url);
    const file = await request.get(endpoint + signed.pathname + signed.search);
    expect((await file.body()).toString()).toContain('% Synthetic invoice fixture');
  }
  await detail.getByRole('button', { name: 'Edit bill' }).click();
  if (process.env.CHALLAN_TEST_FILES) await page.getByLabel('Remove attachment').check();
  await page.getByLabel('Invoice number').fill(editedInvoice);
  await page.getByRole('button', { name: 'Review worker bill' }).click();
  await page.getByRole('button', { name: 'Confirm save', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: new RegExp(editedInvoice) }).click();
  if (attachmentId) {
    await expect(detail.getByText('No attachment')).toBeVisible();
    const detached = await rpc('erp_file_read', { p_id: attachmentId });
    expect(detached.ok()).toBeFalsy();
  }
  page.once('dialog', (dialog) => dialog.accept());
  await detail.getByRole('button', { name: 'Delete bill' }).click();
  await expect(page.getByRole('button', { name: new RegExp(editedInvoice) })).toHaveCount(0);

  const claim = { lines: [{ line: issued[1].lines[0].id, rate: '5' }] };
  const outcomes = await Promise.all([save(true, 'create', claim), save(true, 'create', claim)]);
  expect(outcomes.map((outcome) => outcome.status()).sort()).toEqual([200, 409]);
  const winner = await outcomes.find((outcome) => outcome.ok()).json();
  const winnerBill = (await read(true)).bills.find((bill) => bill.key === winner);
  expect((await save(true, 'delete', winnerBill)).ok()).toBeTruthy();
  await page.getByRole('link', { name: 'Challans', exact: true }).click();
  await page.getByRole('button', { name: new RegExp('Challan ' + challanNumber + ' ') }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await detail.getByRole('button', { name: 'Delete challan' }).click();
  await expect(detail).toHaveCount(0);
  for (const record of issued) expect((await save(false, 'delete', record)).ok()).toBeTruthy();
  expect(errors).toEqual([]);
});
