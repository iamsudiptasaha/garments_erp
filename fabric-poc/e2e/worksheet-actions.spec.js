import { expect, test } from '@playwright/test';

for (const [route, title, add, edit, form] of [
  ['suppliers', 'Suppliers', '+ Add supplier', 'Edit selected document', /supplier/i],
  ['colours', 'Colour library', '+ Add colour', 'Edit selected record', /colour/i],
  ['colourMappings', 'Colour mappings', '+ Add mapping', 'Edit selected record', /mapping/i],
  ['labDips', 'Lab dips', '+ Create edition', 'Edit selected record', /edition|lab dip/i],
]) {
  test(title + ' opens its existing Sheet record form and preserves Overview', async ({ page }) => {
    test.skip(!!process.env.E2E_BASE_URL, 'Uses local sample worksheet records');
    await page.goto('/fabric.html#' + route);
    await page.setViewportSize({ width: 1280, height: 720 });
    const toggle = page.locator('.fabric-page-header .fabric-view-toggle');
    const overview = page.locator('.overview-grid').first();
    await expect(overview).toBeVisible();
    const screenshot = { animations: 'disabled', caret: 'hide' };
    await page.mouse.move(0, 0);
    const before = await overview.screenshot(screenshot);

    await page.getByRole('button', { name: 'Sheet', exact: true }).click();
    await page.getByRole('button', { name: add }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: form })).toBeVisible();
    await page.keyboard.press('Escape');
    const action = page.getByRole('button', { name: edit, exact: true });
    await expect(action).toBeDisabled();
    await page.getByLabel('Sort direction').selectOption('desc');
    await page.locator('.fortune-sheet-overlay').click({ position: { x: 85, y: 82 } });
    await action.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: form })).toBeVisible();
    if (route === 'suppliers')
      await expect(dialog.getByLabel('Company / contact')).toHaveValue('s2');
    if (route === 'colours') await expect(dialog.getByLabel('Colour name')).toHaveValue('Sage');
    if (route === 'colourMappings')
      await expect(dialog.getByLabel('Colour', { exact: true })).toHaveValue('cm2');
    if (route === 'labDips') await expect(dialog.getByLabel('Colour / brand')).toHaveValue('co2');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('searchbox', { name: 'Search ' + title }).fill('no-such-worksheet-record');
    await expect(page.getByText('No matching records.')).toBeVisible();
    await expect(action).toBeDisabled();
    await expect(page.getByLabel('Sheet zoom')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search ' + title }).clear();
    await expect(page.getByText('No matching records.')).toHaveCount(0);
    await page.getByLabel('Sheet zoom').selectOption('1.25');
    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('.worksheet-actions')).toHaveCSS('flex-wrap', 'wrap');
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await toggle.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.mouse.move(0, 0);
    expect(await overview.screenshot(screenshot)).toEqual(before);
    await page.getByRole('button', { name: 'Sheet', exact: true }).click();
    await expect(page.getByLabel('Sheet zoom')).toHaveValue('1.25');
  });
}

for (const [route, title, open, edit, add, record] of [
  [
    'challans',
    'Challans',
    'Open selected challan',
    'Edit selected document',
    '+ New challan',
    'CH-2',
  ],
  [
    'worker-bills',
    'Worker bills',
    'Open selected bill',
    'Edit selected bill',
    '+ New worker bill',
    'WB-2',
  ],
]) {
  test(
    title + ' Sheet selects the right document with independent permissions',
    async ({ page }) => {
      test.skip(!!process.env.E2E_BASE_URL, 'Uses authenticated document fixtures');
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.stack));
      const actor = '00000000-0000-4000-8000-000000000001';
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, exp })}.synthetic`;
      await page.addInitScript(
        ({ token, actor, exp }) =>
          localStorage.setItem(
            'sb-example-auth-token',
            JSON.stringify({
              access_token: token,
              refresh_token: 'synthetic',
              expires_at: exp,
              token_type: 'bearer',
              user: { id: actor, aud: 'authenticated', role: 'authenticated' },
            }),
          ),
        { token, actor, exp },
      );
      let permissions = {
        view: true,
        create: true,
        edit: true,
        format: false,
        print: true,
        export: true,
      };
      const saved = new Map();
      const date = '2026-11-11';
      await page.route('https://example.invalid/**', async (request) => {
        const name = new URL(request.request().url()).pathname.split('/').at(-1);
        const args = request.request().postDataJSON();
        let json;
        if (name === 'erp_access_snapshot') {
          json = {
            enabled: true,
            permissions: { productionChallans: { view: true }, jobWorkerBills: { view: true } },
          };
        } else if (name === 'erp_grid_preferences') {
          expect(args.p_owner).toBe(actor);
          json = { ...saved.get(args.p_grid), ...args.p_patch };
          if (args.p_patch) saved.set(args.p_grid, json);
        } else {
          expect(name).toBe('erp_challan_documents');
          json = {
            pages: { challans: true, billing: true },
            permissions,
            assignments: [
              {
                id: '1',
                style: 'SHIRT',
                part: 'Body',
                worker: 'W',
                worker_name: 'Worker',
                variant: 'Blue',
                stock: { M: 10 },
                job: 'JOB-1',
              },
            ],
            employees: [{ id: '1', name: 'Issuer' }],
            sizeOrder: ['M'],
            challans: [1, 2].map((index) => ({
              id: 'CH-' + index,
              key: 'challan-' + index,
              date,
              employee: '1',
              lines: [
                {
                  id: 'line-' + index,
                  assignment: '1',
                  quantities: { M: index },
                  description: 'Description ' + index,
                  rate: 5,
                },
              ],
            })),
            bills: [1, 2].map((index) => ({
              key: 'bill-' + index,
              number: 'WB-' + index,
              invoiceNumber: 'INV-' + index,
              date,
              items: [{ line: 'line-' + index, rate: 10 + index }],
            })),
          };
        }
        await request.fulfill({ json });
      });
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/production-challan.html#' + route);
      const overview = page.locator('.overview-grid');
      await expect(overview).toBeVisible();
      const screenshot = { animations: 'disabled', caret: 'hide' };
      const before = await overview.screenshot(screenshot);
      await page.getByRole('button', { name: 'Sheet', exact: true }).click();
      const editSelected = page.getByRole('button', { name: edit, exact: true });
      const openSelected = page.getByRole('button', { name: open, exact: true });
      await page.getByRole('button', { name: add }).click();
      if (route === 'challans') {
        await expect(page.getByRole('heading', { name: 'New challan' })).toBeVisible();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      } else {
        const create = page.getByRole('dialog', { name: 'New worker bill' });
        await expect(create.getByLabel('Invoice number')).toBeVisible();
        await create.getByRole('button', { name: 'Close' }).click();
      }
      await expect(openSelected).toBeDisabled();
      await expect(editSelected).toBeDisabled();
      await page.getByLabel('Sort direction').selectOption('desc');
      const selectFirst = () =>
        page.locator('.fortune-sheet-overlay').click({ position: { x: 85, y: 82 } });
      await selectFirst();
      await openSelected.click();
      await expect(page.getByRole('dialog').getByRole('heading', { name: record })).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(errors).toEqual([]);
      await selectFirst();
      await editSelected.click();
      if (route === 'challans') {
        await expect(page.getByRole('heading', { name: 'Edit challan' })).toBeVisible();
        await expect(page.getByLabel('Description')).toHaveValue('Description 2');
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      } else {
        await expect(page.getByLabel('Invoice number')).toHaveValue('INV-2');
      }
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
      const search = page.getByRole('searchbox', { name: 'Search ' + title.toLowerCase() });
      await search.fill('no-match');
      await expect(page.getByText('No matching records.')).toBeVisible();
      await expect(openSelected).toBeDisabled();
      await expect(page.getByLabel('Sheet zoom')).toBeVisible();
      await search.clear();
      await expect(page.getByText('2 rows', { exact: true })).toBeVisible();
      await page.getByLabel('Sheet zoom').selectOption('1.25');
      for (const width of [1024, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const toolbar = page.locator('.worksheet-actions');
        await expect(toolbar).toHaveCSS('flex-wrap', 'wrap');
        const bounds = await toolbar.boundingBox();
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      await page
        .getByRole('region', { name: 'Production documents' })
        .getByRole('button', { name: 'Overview', exact: true })
        .click();
      await page.mouse.move(0, 0);
      expect(await overview.screenshot(screenshot)).toEqual(before);
      permissions = {
        view: true,
        create: false,
        edit: false,
        format: false,
        print: false,
        export: false,
      };
      await page.reload();
      await page.getByRole('button', { name: 'Sheet', exact: true }).click();
      await expect(page.getByLabel('Sheet zoom')).toHaveValue('1.25');
      await expect(editSelected).toHaveCount(0);
      await expect(page.getByRole('button', { name: add })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Print / PDF' })).toHaveCount(0);
      await expect(openSelected).toBeDisabled();
      await page.getByLabel('Sheet zoom').selectOption('1');
      await selectFirst();
      await openSelected.click();
      await expect(page.getByRole('dialog').getByRole('heading', { name: record })).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(errors).toEqual([]);
    },
  );
}
