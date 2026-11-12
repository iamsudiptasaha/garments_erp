import { test, expect } from '@playwright/test';

test('signed-in Finished Goods keeps manual price independent of costing and finalizes a draft', async ({
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
  const gridPreferences = new Map();
  const prices = [];
  const movements = [];
  const stockWrites = [];
  const types = [{ id: '12', name: 'Wholesale' }];
  const entries = [];
  const saves = [];
  const item = { id: '7', label: 'Test shirt' };
  const product = {
    id: '9',
    sku: 'SHIRT-SET',
    name: 'Shirt set',
    active: true,
    verified: true,
    components: [{ id: '11', item: item.label, size: 'M', pieces: 2, reference_cost: 23 }],
  };
  const products = [product];
  const costing = {
    id: '16',
    item_label: item.label,
    version: 2,
    status: 'draft',
    completed_units: 10,
    updated_at: '2026-11-09T10:00:00Z',
    lines: [
      {
        id: '17',
        description: 'Stitching',
        section: 'Production',
        reference_quantity: 10,
        reference_amount: 230,
        approved_quantity: 10,
        approved_rate: 23,
      },
    ],
  };
  const oldVersion = { ...costing, id: '15', version: 1, status: 'finalized' };
  const history = [oldVersion];
  let permission = { view: true, create: true, format: true, export: true, print: true };
  await page.route('https://example.invalid/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    const args = route.request().postDataJSON();
    let body;
    switch (name) {
      case 'erp_account_security':
        body = { enabled: true, ready: true };
        break;
      case 'erp_access_snapshot':
        body = {
          actor,
          enabled: true,
          administrator: false,
          permissions: {
            finishedProducts: permission,
          },
        };
        break;
      case 'erp_finished_goods_summary':
        body = {
          sizes: [
            { size_id: '23', item_id: '8', style_code: 'OTHER', size: 'L', total_produced: 1 },
            {
              size_id: '13',
              item_id: item.id,
              style_code: 'TEST-SHIRT',
              size: 'M',
              total_produced: 10,
            },
          ],
          variations: [
            { id: '9', style_code: 'SHIRT-SET', size: 'M', components: [{ item_id: item.id }] },
          ],
        };
        break;
      case 'erp_finished_goods_movements':
        body = movements.filter(({ adjustment }) => adjustment === args.p_adjustment);
        break;
      case 'erp_grid_preferences': {
        body = { ...gridPreferences.get(args.p_grid), ...args.p_patch };
        if (args.p_patch) gridPreferences.set(args.p_grid, body);
        break;
      }
      case 'erp_create_finished_production':
      case 'erp_adjust_finished_stock': {
        const adjustment = name === 'erp_adjust_finished_stock';
        stockWrites.push(args);
        body = String(30 + stockWrites.length);
        movements.push({
          id: body,
          adjustment,
          item: item.label,
          pieces: 10,
          delta: args.p_delta,
          reason: args.p_reason,
          employee: 'E-14',
        });
        break;
      }
      case 'erp_finished_stock_valuation':
        body = [
          {
            item_id: item.id,
            style_code: 'TEST-SHIRT',
            size: '16-20',
            pieces: 10,
            base_price: 23,
            stock_value: 230,
          },
        ];
        break;
      case 'erp_finished_goods_choices':
        body = {
          items: [
            {
              ...item,
              costing_finalized: true,
              sizes: [{ id: '13', label: 'M' }],
              jobs: [{ id: '22', label: 'RTD-22' }],
            },
          ],
          employees: [{ id: '14', label: 'E-14' }],
        };
        break;
      case 'erp_finished_goods_catalogue':
        body = {
          products,
          prices,
          types,
          sizes: [{ id: '13', item: item.label, size: 'M' }],
          employees: [{ id: '14', label: 'E-14' }],
        };
        break;
      case 'erp_create_finished_catalogue_entry':
        entries.push(args);
        if (args.p_kind === 'prices')
          prices.push({ id: '18', product: product.sku, type: 'Wholesale', ...args.p_entry });
        if (args.p_kind === 'priceTypes') types.push({ id: '19', ...args.p_entry });
        if (args.p_kind === 'products')
          products.push({ id: '20', active: true, verified: true, ...args.p_entry });
        body = '18';
        break;
      case 'erp_item_costing_read':
        body = args.p_item_id ? history : [item];
        break;
      case 'erp_item_costing_start':
        history.unshift(costing);
        body = costing.id;
        break;
      case 'erp_item_costing_save':
        saves.push(args);
        Object.assign(costing.lines[0], args.p_lines[0]);
        costing.status = args.p_finalize ? 'finalized' : 'draft';
        costing.updated_at = args.p_finalize ? '2026-11-09T12:00:00Z' : '2026-11-09T11:00:00Z';
        body = costing.id;
        break;
      default:
        throw Error(`Unexpected Finished Goods request: ${name}`);
    }
    await route.fulfill({ json: body });
  });

  await page.goto('/fabric.html?live=1#finishedProducts');
  const nav = page.getByRole('navigation', { name: 'Finished Goods pages' });
  await expect(nav.getByRole('button')).toHaveCount(9);
  for (const title of [
    'Item stock summary',
    'Sellable summary',
    'Stock valuation',
    'Items produced',
    'Stock adjustments',
    'Sellable products',
    'Price types',
  ]) {
    await nav.getByRole('button', { name: title, exact: true }).click();
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  }
  await nav.getByRole('button', { name: 'Item prices', exact: true }).click();
  const colours = await page.context().newPage();
  await colours.goto('/fabric.html#labDips');
  const referenceToggle = colours.locator('.fabric-page-header .fabric-view-toggle');
  const pricesToggle = page.getByRole('group', { name: 'Item prices view' });
  await expect(referenceToggle).toBeVisible();
  await Promise.all([colours, page].map((tab) => tab.evaluate(() => document.fonts.ready)));
  await page.mouse.move(0, 0);
  const screenshot = { animations: 'disabled', caret: 'hide' };
  expect(await pricesToggle.screenshot(screenshot)).toEqual(
    await referenceToggle.screenshot(screenshot),
  );
  await colours.close();
  await page.getByRole('button', { name: '+ Add price version', exact: true }).click();
  await page.getByRole('combobox', { name: 'Sellable product', exact: true }).fill('SHIRT');
  await page.getByRole('option', { name: 'SHIRT-SET · Shirt set' }).click();
  await expect(page.getByRole('region', { name: 'Item Costing lookup' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '23', exact: true })).toBeVisible();
  await expect(page.getByLabel('Price per piece')).toHaveValue('');
  await page.getByRole('combobox', { name: 'Price type', exact: true }).fill('Whole');
  await page.getByRole('option', { name: 'Wholesale', exact: true }).click();
  await page.getByLabel('Version', { exact: true }).fill('v1');
  await page.getByLabel('Price per piece').fill('62.50');
  await page.getByLabel('Date', { exact: true }).fill('2026-11-09');
  await page.getByRole('button', { name: 'Add price version', exact: true }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  expect(entries[0].p_entry).toMatchObject({ product_id: '9', price_per_piece: '62.50' });

  const priceView = page.getByRole('group', { name: 'Item prices view' });
  await priceView.getByRole('button', { name: 'Sheet', exact: true }).click();
  await expect(page.getByText('Values protected · formatting enabled')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Sheet zoom' }).selectOption('1.25');
  await priceView.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.overview-grid').getByText('62.50', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View contents →' }).click();
  const contents = page.getByRole('dialog', { name: 'Sellable product contents' });
  await expect(contents.getByRole('cell', { name: '23', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(contents).toHaveCount(0);
  await priceView.getByRole('button', { name: 'Sheet', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Sheet zoom' })).toHaveValue('1.25');
  expect(entries).toHaveLength(1);

  await nav.getByRole('button', { name: 'Item costing', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Manufactured item', exact: true })
    .selectOption(item.id);
  await page.getByRole('button', { name: 'Start costing draft' }).click();
  await page.getByLabel('Stitching approved rate', { exact: false }).fill('25');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect.poll(() => saves.length).toBe(1);
  await page
    .getByRole('combobox', { name: 'Compare version', exact: true })
    .selectOption(oldVersion.id);
  await expect(page.getByRole('region', { name: 'Comparison version' })).toBeVisible();
  await page.getByRole('button', { name: 'Finalize costing' }).click();
  await expect(page.getByRole('button', { name: 'Finalize costing' })).toHaveCount(0);
  expect(saves.map(({ p_finalize }) => p_finalize)).toEqual([false, true]);

  await nav.getByRole('button', { name: 'Items produced', exact: true }).click();
  await page.getByRole('button', { name: '+ Record stock-in' }).click();
  await page.getByRole('combobox', { name: 'Manufactured item' }).selectOption('7');
  await page.getByRole('combobox', { name: 'Verifying employee' }).selectOption('14');
  await page.getByLabel('Actual pieces · M').fill('10');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.locator('.overview-grid').getByText('31', { exact: true })).toBeVisible();
  expect(stockWrites[0]).toMatchObject({ p_job_id: '22', p_pieces: { 13: 10 } });

  await nav.getByRole('button', { name: 'Stock adjustments', exact: true }).click();
  await page.getByRole('button', { name: '+ Add adjustment' }).click();
  await page.getByRole('combobox', { name: 'Manufactured item' }).selectOption('7');
  await page.getByRole('combobox', { name: 'Verifying employee' }).selectOption('14');
  await page.getByRole('combobox', { name: 'Size', exact: true }).selectOption('13');
  await page.getByLabel('Quantity change').fill('-2');
  await page.getByLabel('Reason').fill('Recount');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.locator('.overview-grid').getByText('Recount', { exact: true })).toBeVisible();
  expect(stockWrites[1]).toMatchObject({ p_delta: -2, p_size_id: '13' });

  await nav.getByRole('button', { name: 'Price types', exact: true }).click();
  await page.getByRole('button', { name: '+ Add price type', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Retail');
  await page.getByRole('button', { name: 'Save price type' }).click();
  await expect(page.locator('.overview-grid').getByText('Retail', { exact: true })).toBeVisible();

  await nav.getByRole('button', { name: 'Sellable products', exact: true }).click();
  await page.getByRole('button', { name: '+ Add sellable product', exact: true }).click();
  await page.getByLabel('SKU', { exact: true }).fill('SHIRT-TRIO');
  await page.getByLabel('Name', { exact: true }).fill('Shirt trio');
  await page.getByRole('combobox', { name: 'Manufactured item and size' }).fill('Test shirt');
  await page.getByRole('option', { name: 'Test shirt · M' }).click();
  await page.getByLabel('Pieces per set (share weight)').fill('3');
  await expect(page.getByRole('region', { name: 'One sellable set' })).toContainText('3 pieces');
  await page.getByRole('combobox', { name: 'Verifying employee' }).fill('E-14');
  await page.getByRole('option', { name: 'E-14' }).click();
  await page.getByRole('button', { name: 'Verify composition' }).click();
  await expect(
    page.locator('.overview-grid').getByText('SHIRT-TRIO', { exact: true }),
  ).toBeVisible();
  expect(entries.at(-1).p_entry.components).toEqual([{ size_id: '13', pieces: 3 }]);

  for (const [title, action, dialogName, identity, create] of [
    ['Item stock summary', 'View selected costing history', 'Item costing history', item.label],
    ['Sellable summary', 'View selected costing history', 'Item costing history', item.label],
    ['Stock valuation', 'View selected costing history', 'Item costing history', item.label],
    ['Items produced', 'Open selected stock-in', 'Stock-in receipts', '31', '+ Record stock-in'],
    [
      'Stock adjustments',
      'Open selected adjustment',
      'Verified adjustments',
      'Recount',
      '+ Add adjustment',
    ],
    [
      'Sellable products',
      'View selected contents',
      'Sellable product contents',
      'SHIRT-TRIO · Shirt trio',
      '+ Add sellable product',
    ],
    [
      'Item prices',
      'View selected contents',
      'Sellable product contents',
      'SHIRT-SET · Shirt set',
      '+ Add price version',
    ],
    ['Price types', 'Open selected price type', 'Price type', 'Wholesale', '+ Add price type'],
  ]) {
    await test.step(title + ' worksheet contract', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await nav.getByRole('button', { name: title, exact: true }).click();
      const views = page.getByRole('group', { name: title + ' view' });
      await views.getByRole('button', { name: 'Overview' }).click();
      const cards = page.locator('.overview-grid');
      await expect(cards).toBeVisible();
      const screenshot = { animations: 'disabled', caret: 'hide' };
      await page.mouse.move(0, 0);
      const overview = await cards.screenshot(screenshot);
      await views.getByRole('button', { name: 'Sheet' }).click();
      const selected = page.getByRole('button', { name: action, exact: true });
      await expect(selected).toBeDisabled();
      await expect(page.getByRole('button', { name: /Edit selected/ })).toHaveCount(0);
      const zoom = page.getByLabel('Sheet zoom');
      await expect(zoom).toBeVisible();
      await zoom.selectOption('1');
      await expect(page.getByText('Columns', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
      if (create) {
        await page.getByRole('button', { name: create }).click();
        const createForm = page.getByRole('dialog');
        await expect(createForm.locator('form')).toBeVisible();
        await createForm.getByRole('button', { name: 'Close', exact: true }).click();
      }
      await page.getByLabel('Sort direction').selectOption('desc');
      const overlay = page.locator('.fortune-sheet-overlay');
      await overlay.click({ position: { x: 85, y: 82 } });
      if (title === 'Item stock summary') {
        await page.keyboard.press('Delete');
        await page.getByRole('button', { name: 'Print / PDF' }).click();
        await expect(page.getByRole('dialog').locator('tbody tr').first()).toContainText(
          'TEST-SHIRT',
        );
        await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
        await overlay.click({ position: { x: 85, y: 82 } });
      }
      await selected.click();
      const dialog = page.getByRole('dialog', { name: dialogName });
      await expect(dialog).toContainText(identity);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await zoom.selectOption('1.5');
      const toolbar = page.locator('.worksheet-actions');
      for (const width of [1024, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(toolbar).toHaveCSS('flex-wrap', 'wrap');
        const bounds = await toolbar.boundingBox();
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      await views.getByRole('button', { name: 'Overview' }).click();
      await page.mouse.move(0, 0);
      expect(await cards.screenshot(screenshot)).toEqual(overview);
      await views.getByRole('button', { name: 'Sheet' }).click();
      await expect(zoom).toHaveValue('1.5');
      await expect(selected).toBeDisabled();
    });
  }

  permission = { view: true };
  await page.reload();
  await expect(nav.getByRole('button')).toHaveCount(9);
  for (const [title, readValue, writeAction] of [
    ['Sellable products', 'SHIRT-TRIO', '+ Add sellable product'],
    ['Price types', 'Retail', '+ Add price type'],
    ['Item prices', '62.50', '+ Add price version'],
  ]) {
    await nav.getByRole('button', { name: title, exact: true }).click();
    await expect(
      page.locator('.overview-grid').getByText(readValue, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: writeAction })).toHaveCount(0);
    await page
      .getByRole('group', { name: title + ' view' })
      .getByRole('button', { name: 'Sheet' })
      .click();
    await expect(page.getByText('Read-only access', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: writeAction })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
  }
  await nav.getByRole('button', { name: 'Stock valuation', exact: true }).click();
  const valuation = page.getByRole('group', { name: 'Stock valuation view' });
  await expect(valuation.getByRole('button', { name: 'Sheet' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await valuation.getByRole('button', { name: 'Overview' }).click();
  const valuationCard = page.locator('.overview-card').filter({ hasText: 'TEST-SHIRT' });
  await expect(valuationCard).toContainText('16-20');
  await expect(valuationCard).toContainText('Stock value230');

  permission = { view: false };
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Finished Goods access restricted' }),
  ).toBeVisible();
  await expect(nav).toHaveCount(0);
});

test('sample costing worksheet supports draft review and a read-only finalized version', async ({
  page,
}) => {
  await page.goto('/fabric.html?finishedGoods=costing#finishedProducts');
  const preview = page.getByRole('region', { name: 'Item Costing mockup' });
  await expect(preview).toContainText('Accepted Ready to Dispatch pieces: 74');
  const rate = preview.getByRole('spinbutton', { name: 'Printing approved rate per piece' });
  await expect(rate).toHaveValue('15');
  await rate.fill('16');
  await expect(preview).toContainText('₹1,280.00');
  await preview.getByRole('combobox', { name: 'Sample version' }).selectOption('finalized');
  await expect(rate).toHaveValue('14');
  await expect(rate).toBeDisabled();
});
