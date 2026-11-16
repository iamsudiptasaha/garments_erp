import { test, expect } from '@playwright/test';

test('Finished Goods Sheet and Fabric Overview restore private grid settings across browsers', async ({
  browser,
}) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Uses local authenticated fixtures');
  const saved = new Map();
  const searches = [];
  const first = '00000000-0000-4000-8000-000000000001';
  const second = '00000000-0000-4000-8000-000000000002';
  const contexts = [];
  const stock = [
    { size_id: '1', style_code: 'SHIRT-A', size: 'M', total_produced: 2 },
    { size_id: '2', style_code: 'SHIRT-B', size: 'S', total_produced: 10 },
  ];

  async function open(actor, viewport) {
    const context = await browser.newContext({ viewport });
    contexts.push(context);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, exp })}.synthetic`;
    await context.addInitScript(
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
    await context.route('https://example.invalid/**', async (route) => {
      const request = route.request();
      const name = new URL(request.url()).pathname.split('/').at(-1);
      const args = request.postDataJSON();
      let json;
      switch (name) {
        case 'erp_account_security':
          json = { enabled: true, ready: true };
          break;
        case 'erp_access_snapshot':
          json = {
            actor,
            enabled: true,
            permissions: {
              finishedProducts: { view: true, format: true, export: true, print: true },
              yarnTypes: { view: true },
            },
          };
          break;
        case 'erp_finished_goods_summary':
          searches.push(args.p_sku);
          json = { sizes: stock.filter((row) => !args.p_sku || row.style_code === args.p_sku) };
          break;
        case 'erp_fabric_snapshot':
          json = {
            yarn_type: [
              { id: '1', name: 'Cotton', yarn_count: '30S' },
              { id: '2', name: 'Linen', yarn_count: '24S' },
            ],
          };
          break;
        case 'erp_dyed_bill_verifiers':
          json = [];
          break;
        case 'erp_grid_preferences': {
          expect(args.p_owner).toBe(actor);
          const key = actor + ':' + args.p_grid;
          json = { ...saved.get(key), ...args.p_patch };
          if (args.p_patch) saved.set(key, json);
          break;
        }
        default:
          throw Error('Unexpected grid fixture request ' + name);
      }
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    await page.goto('/fabric.html?live=1#finishedProducts');
    await expect(page.getByLabel('Sheet zoom')).toBeVisible();
    return page;
  }

  try {
    const page = await open(first, { width: 1440, height: 900 });
    const search = page.getByRole('searchbox', { name: 'Exact SKU' });
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
    await search.fill('SHIRT');
    await search.fill('SHIRT-B');
    await expect(page.getByText('1 row', { exact: true })).toBeVisible();
    expect(searches).toEqual([null, 'SHIRT-B']);
    await search.clear();
    await expect(page.getByText('2 rows', { exact: true })).toBeVisible();
    await page.getByLabel('Sort column').selectOption('total_produced');
    await page.getByLabel('Sort direction').selectOption('desc');
    await page.getByRole('button', { name: 'Print / PDF' }).click();
    let report = page.getByRole('dialog').locator('tbody tr');
    await expect(report.first()).toContainText('SHIRT-B');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Sort direction').selectOption('asc');
    await page.getByRole('button', { name: 'Print / PDF' }).click();
    report = page.getByRole('dialog').locator('tbody tr');
    await expect(report.first()).toContainText('SHIRT-A');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Sort direction').selectOption('desc');
    await page.locator('.fortune-sheet-overlay').click({ position: { x: 85, y: 82 } });
    await page.getByRole('button', { name: /^Bold / }).click();
    await expect
      .poll(() => saved.get(first + ':finished-goods-sizes')?.styles?.['2']?.style_code?.bl)
      .toBe(1);
    await page.getByLabel('Sheet zoom').selectOption('1.25');
    await page.getByText('Columns', { exact: true }).click();
    await page.getByLabel('Width (px)').fill('220');
    await page.getByLabel('Width (px)').press('Enter');
    await page.getByRole('button', { name: 'Move right' }).click();
    await page.getByLabel('Column to configure').selectOption('produced');
    await page.getByRole('button', { name: 'Hide column' }).click();
    await expect
      .poll(() => saved.get(first + ':finished-goods-sizes'))
      .toMatchObject({
        sort: { key: 'total_produced', direction: 'desc' },
        layout: { zoomRatio: 1.25 },
        columnWidths: { style_code: 220 },
        hidden: ['produced'],
        order: [
          'size',
          'style_code',
          'total_produced',
          'produced',
          'adjusted',
          'returned',
          'held',
          'sold',
          'available',
        ],
      });
    await page.reload();
    await expect(page.getByLabel('Sheet zoom')).toHaveValue('1.25');
    await expect(page.getByLabel('Sort direction')).toHaveValue('desc');
    const phone = await open(first, { width: 390, height: 844 });
    await expect(phone.getByLabel('Sheet zoom')).toHaveValue('1.25');
    await expect(phone.getByLabel('Sort column')).toHaveValue('total_produced');
    await phone.getByRole('button', { name: 'Print / PDF' }).click();
    const printed = phone.getByRole('dialog');
    await expect(printed.locator('thead th, thead td').first()).toHaveText('Size');
    await expect(printed.getByText('Verified pieces', { exact: true })).toHaveCount(0);
    await expect(printed.getByText('SHIRT-B', { exact: true })).toHaveCSS('font-weight', '700');
    await printed.getByRole('button', { name: 'Close', exact: true }).click();
    await phone.getByText('Columns', { exact: true }).click();
    await phone.getByLabel('Column to configure').selectOption('style_code');
    await expect(phone.getByLabel('Width (px)')).toHaveValue('220');
    await phone.getByLabel('Column to configure').selectOption('produced');
    await expect(phone.getByRole('button', { name: 'Show column' })).toBeVisible();
    await phone.getByText('Columns', { exact: true }).click();
    expect(
      await phone
        .locator('.sheet-exports')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    const toolbar = phone.locator('.sheet-exports');
    await phone.mouse.move(0, 0);
    const screenshot = { animations: 'disabled', caret: 'hide' };
    async function toolbarImage() {
      await toolbar.evaluate(async (element) => {
        document.activeElement.blur();
        await document.fonts.ready;
        element.scrollIntoView({ block: 'center' });
      });
      return toolbar.screenshot(screenshot);
    }
    const before = await toolbarImage();
    await phone.reload();
    await expect(phone.getByLabel('Sheet zoom')).toHaveValue('1.25');
    const after = await toolbarImage();
    const maxDifference = await phone.evaluate(
      async ([before, after]) => {
        async function pixels(encoded) {
          const image = new Image();
          image.src = 'data:image/png;base64,' + encoded;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, canvas.width, canvas.height);
        }
        const [a, b] = await Promise.all([pixels(before), pixels(after)]);
        if (a.width !== b.width || a.height !== b.height) return 255;
        return a.data.reduce(
          (max, value, index) => Math.max(max, Math.abs(value - b.data[index])),
          0,
        );
      },
      [before.toString('base64'), after.toString('base64')],
    );
    expect(maxDifference).toBeLessThanOrEqual(10);
    const other = await open(second, { width: 1024, height: 768 });
    await expect(other.getByLabel('Sheet zoom')).toHaveValue('1');
    await expect(other.getByLabel('Sort direction')).toHaveValue('asc');

    const yarnTypes = '/fabric.html?live=1#yarnTypes';
    await page.goto(yarnTypes);
    const overviewSearch = (device) => device.getByRole('searchbox', { name: 'Search Yarn types' });
    await overviewSearch(page).fill('Linen');
    await page.getByRole('button', { name: 'Group', exact: true }).click();
    await page.getByRole('button', { name: '+ Add grouping level' }).click();
    await page.getByLabel('Group field 1').selectOption('count');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await expect
      .poll(() => saved.get(first + ':overview-yarnTypes'))
      .toMatchObject({
        search: 'Linen',
        grouping: ['count'],
      });
    await phone.goto(yarnTypes);
    await expect(overviewSearch(phone)).toHaveValue('Linen');
    await expect(phone.getByRole('button', { name: /▸ 24S/ })).toBeVisible();
    await other.goto(yarnTypes);
    await expect(overviewSearch(other)).toHaveValue('');
    await expect(other.getByRole('cell', { name: 'Cotton', exact: true })).toBeVisible();
    await expect(other.getByRole('cell', { name: 'Linen', exact: true })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('Administration and Files keep actions available when a saved column is hidden', async ({
  page,
}) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Uses local authenticated fixtures');
  const actor = '00000000-0000-4000-8000-000000000001';
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, exp })}.synthetic`;
  await page.addInitScript(
    ({ actor, token, exp }) => {
      localStorage.setItem(
        'sb-example-auth-token',
        JSON.stringify({
          access_token: token,
          refresh_token: 'synthetic',
          expires_at: exp,
          token_type: 'bearer',
          user: { id: actor, aud: 'authenticated', role: 'authenticated' },
        }),
      );
    },
    { actor, token, exp },
  );
  const preferences = new Map();
  await page.route('https://example.invalid/**', async (route) => {
    const request = route.request();
    const name = new URL(request.url()).pathname.split('/').at(-1);
    if (name === 'erp_grid_preferences') {
      const { p_grid, p_owner, p_patch } = request.postDataJSON();
      expect(p_owner).toBe(actor);
      if (p_patch) preferences.set(p_grid, { ...preferences.get(p_grid), ...p_patch });
      return route.fulfill({ json: preferences.get(p_grid) ?? {} });
    }
    const fixtures = {
      settings: { external: {} },
      erp_account_security: { enabled: true, ready: true },
      erp_access_snapshot: { actor, enabled: true, administrator: true },
      erp_admin_snapshot: {
        accounts: [
          {
            user_id: actor,
            employee_id: '7',
            name: 'Test Admin',
            employee_code: 'EMP-7',
            role_ids: [],
            is_active: true,
          },
        ],
        employees: [{ id: '7', name: 'Test Admin', employee_code: 'EMP-7', is_active: true }],
        auth_accounts: [{ id: actor, email: 'admin@example.invalid' }],
        roles: [],
        audit: [],
      },
      erp_file_registry: [
        {
          id: 'items',
          group: 'items',
          bucket_id: 'private-items',
          private: true,
          mime: [],
          max_bytes: 1048576,
          route_count: 1,
        },
      ],
      erp_file_routes: [
        {
          key: 'fixture',
          table: 'item',
          slot: 'attachment',
          bucket_group_id: 'items',
          mime: [],
          max_bytes: 1048576,
          enabled: true,
        },
      ],
    };
    expect(fixtures[name], name).toBeDefined();
    return route.fulfill({ json: fixtures[name] });
  });
  for (const [path, grid, field, column, action] of [
    ['/access.html#adminAccess', 'administration-accounts', 'employee', 'Employee', 'View details'],
    ['/files-admin.html', 'files-buckets', 'bucket', 'Private bucket', 'Edit settings'],
    ['/files-admin.html', 'files-upload-routes', 'source', 'Attachment source', 'Edit route'],
  ]) {
    await page.goto(path);
    const table = page
      .locator('.erp-record-grid')
      .filter({ has: page.getByRole('button', { name: action, exact: true }) });
    await table.getByText('Columns', { exact: true }).click();
    await table.getByLabel('Column to configure').selectOption(field);
    await table.getByRole('button', { name: 'Hide column' }).click();
    await expect.poll(() => preferences.get(grid)?.hidden).toEqual([field]);
    await page.reload();
    await expect(table.getByText('Columns', { exact: true })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: column, exact: true })).toHaveCount(0);
    await expect(table.getByRole('button', { name: action, exact: true })).toBeEnabled();
  }
});
