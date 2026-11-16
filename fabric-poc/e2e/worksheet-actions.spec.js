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
    const overview = page.getByRole('table', { name: title, exact: true });
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
    await expect
      .poll(async () => (await overview.screenshot(screenshot)).equals(before))
      .toBe(true);
    await page.getByRole('button', { name: 'Sheet', exact: true }).click();
    await expect(page.getByLabel('Sheet zoom')).toHaveValue('1.25');
  });
}

async function documentFixtures(page, referencePages = {}) {
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
  const permissions = {
    create: true,
    edit: true,
    delete: true,
    format: false,
    print: true,
    export: true,
  };
  const saved = new Map();
  const reads = [];
  let deleted = false;
  let beforeRead = () => {};
  const date = '2026-11-11';
  await page.route('https://example.invalid/**', async (request) => {
    const name = new URL(request.request().url()).pathname.split('/').at(-1);
    const args = request.request().postDataJSON();
    let json;
    if (name === 'erp_account_security') {
      json = { enabled: true, ready: true };
    } else if (name === 'erp_access_snapshot') {
      json = {
        actor,
        enabled: true,
        permissions: {
          productionChallans: { view: true },
          jobWorkerBills: { view: true },
          ...referencePages,
        },
      };
    } else if (name === 'erp_grid_preferences') {
      expect(args.p_owner).toBe(actor);
      json = { ...saved.get(args.p_grid), ...args.p_patch };
      if (args.p_patch) saved.set(args.p_grid, json);
    } else if (name === 'erp_save_challan_document') {
      expect(args).toMatchObject({ p_billing: true, p_action: 'delete' });
      deleted = true;
      json = args.p_document.key;
    } else if (
      [
        'erp_fabric_snapshot',
        'erp_production_workspace',
        'erp_raw_material_transaction_snapshot',
      ].includes(name)
    ) {
      json = {};
    } else if (name === 'erp_dyed_bill_verifiers') {
      json = [];
    } else {
      expect(name).toBe('erp_challan_documents');
      reads.push(args.p_billing ? 'bills' : 'challans');
      await beforeRead(args.p_billing);
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
        bills: (deleted ? [2] : [1, 2]).map((index) => ({
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
  return {
    permissions,
    reads,
    pauseReads: (callback) => {
      beforeRead = callback;
    },
  };
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
      const { permissions } = await documentFixtures(page);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/production-challan.html#' + route);
      const overview = page.getByRole('region', { name: title + ' Overview', exact: true });
      const table = overview.getByRole('table', { name: title, exact: true });
      const selectView = (name) =>
        page
          .getByRole('region', { name: 'Production documents' })
          .getByRole('button', { name, exact: true })
          .click();
      const captureOverview = async () => {
        await page.mouse.move(0, 0);
        await page.evaluate(async () => {
          await document.fonts.ready;
          document.activeElement?.blur();
          window.scrollTo(0, 0);
        });
        return overview.screenshot({ animations: 'disabled', caret: 'hide' });
      };
      await selectView('Sheet');
      await expect(page.getByLabel('Sheet zoom')).toBeVisible();
      await selectView('Overview');
      await expect(table.getByRole('row')).toHaveCount(3);
      const before = await captureOverview();
      await selectView('Sheet');
      await expect(page.getByLabel('Sheet zoom')).toBeVisible();
      await selectView('Overview');
      await expect
        .poll(async () => {
          const after = await captureOverview();
          if (after.equals(before)) return null;
          return page.evaluate(
            async ([before, after]) => {
              const decode = async (png) => {
                const image = await createImageBitmap(
                  await (await fetch('data:image/png;base64,' + png)).blob(),
                );
                const canvas = new OffscreenCanvas(image.width, image.height);
                const context = canvas.getContext('2d');
                context.drawImage(image, 0, 0);
                image.close();
                return context.getImageData(0, 0, canvas.width, canvas.height);
              };
              const [first, second] = await Promise.all([decode(before), decode(after)]);
              if (first.width !== second.width || first.height !== second.height)
                return {
                  before: [first.width, first.height],
                  after: [second.width, second.height],
                };
              let left = first.width,
                top = first.height,
                right = -1,
                bottom = -1,
                changed = 0;
              for (let i = 0; i < first.data.length; i += 4) {
                if (
                  first.data
                    .subarray(i, i + 4)
                    .every((value, channel) => value === second.data[i + channel])
                )
                  continue;
                const pixel = i / 4;
                const x = pixel % first.width;
                const y = Math.floor(pixel / first.width);
                left = Math.min(x, left);
                right = Math.max(x, right);
                top = Math.min(y, top);
                bottom = Math.max(y, bottom);
                changed++;
              }
              return changed ? { changed, left, top, right, bottom } : null;
            },
            [before.toString('base64'), after.toString('base64')],
          );
        })
        .toBeNull();
      await overview.getByRole('searchbox').fill(route === 'challans' ? 'Description 2' : 'INV-2');
      await expect(table.getByRole('button', { name: record, exact: true })).toBeVisible();
      await expect(table.getByRole('row')).toHaveCount(2);
      await table.getByRole('button', { name: record, exact: true }).click();
      const detail = page.getByRole('dialog');
      await expect(detail.getByRole('heading', { name: record, exact: true })).toBeVisible();
      await detail.getByRole('button', { name: 'Close' }).click();
      await overview.getByRole('button', { name: 'Clear search' }).click();
      await expect(table.getByRole('row')).toHaveCount(3);
      await expect(overview).toBeVisible();
      await selectView('Sheet');
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
      Object.assign(permissions, {
        create: false,
        edit: false,
        format: false,
        print: false,
        export: false,
      });
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

test('production document views retain their DOM and cache across workspace navigation', async ({
  page,
}) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Uses authenticated document fixtures');
  const { reads, pauseReads } = await documentFixtures(page);
  const documentRequests = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const stats = { mounts: 0, loading: 0 };
    const panels = new WeakSet();
    const placeholders = new WeakSet();
    window.documentViewStats = stats;
    const inspect = (element) => {
      if (!(element instanceof Element)) return;
      for (const panel of [element, ...element.querySelectorAll('.production-documents')]) {
        if (!panel.matches('.production-documents') || panels.has(panel)) continue;
        panels.add(panel);
        stats.mounts++;
      }
      for (const status of [element, ...element.querySelectorAll('[role=status]')]) {
        if (
          !status.matches('.production-documents [role=status]') ||
          status.textContent !== 'Loading production documents…' ||
          placeholders.has(status)
        )
          continue;
        placeholders.add(status);
        stats.loading++;
      }
    };
    new MutationObserver((mutations) => {
      for (const mutation of mutations) for (const node of mutation.addedNodes) inspect(node);
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/production-challan.html#challans');
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentRequests.push(request.url());
  });
  const title = page.getByRole('heading', { name: 'Challans', exact: true });
  const search = page.getByRole('searchbox', { name: 'Search challans' });
  const challanRow = page.getByRole('button', { name: 'CH-1', exact: true });
  const go = (name) => page.getByRole('link', { name, exact: true }).click();
  const activePanel = page.getByRole('region', { name: 'Production documents' });
  const toggle = (name) => activePanel.getByRole('button', { name, exact: true }).click();
  await expect(challanRow).toBeVisible();
  const titleNode = await title.elementHandle();
  const searchNode = await search.elementHandle();
  const challanNode = await challanRow.elementHandle();
  await search.fill('CH-1');
  await toggle('Sheet');
  await expect(activePanel.getByLabel('Sheet zoom')).toBeVisible();
  const zoomNode = await activePanel.getByLabel('Sheet zoom').elementHandle();
  await toggle('Overview');
  await go('Worker bills');
  await expect(page.getByRole('button', { name: 'WB-1' })).toBeVisible();
  await toggle('Sheet');
  await expect(activePanel.getByLabel('Sheet zoom')).toBeVisible();
  await toggle('Overview');
  await page
    .getByRole('navigation', { name: 'Workspace overview' })
    .getByRole('button', { name: 'Overview', exact: true })
    .click();
  await go('Challans');
  await expect(challanRow).toBeVisible();
  await expect(search).toHaveValue('CH-1');
  await go('Worker bills');
  await expect(page.getByRole('button', { name: 'WB-1' })).toBeVisible();
  await go('Challans');
  await expect(challanRow).toBeVisible();
  const instrumentation = await page.evaluate(() => window.documentViewStats);
  console.log(JSON.stringify({ ...instrumentation, reads, documentRequests }));
  expect(instrumentation).toEqual({ mounts: 2, loading: 2 });
  expect(reads).toEqual(['challans', 'bills']);
  expect(documentRequests).toEqual([]);
  const sameNode = (locator, original) =>
    locator.evaluate((node, before) => node === before, original);
  expect(await sameNode(title, titleNode)).toBe(true);
  expect(await sameNode(search, searchNode)).toBe(true);
  expect(await sameNode(challanRow, challanNode)).toBe(true);
  await toggle('Sheet');
  expect(await sameNode(activePanel.getByLabel('Sheet zoom'), zoomNode)).toBe(true);
  await activePanel.getByRole('button', { name: 'Print / PDF' }).click();
  const print = page.getByRole('dialog');
  await expect(print.getByRole('heading', { name: 'Challans', exact: true })).toBeVisible();
  await print.getByRole('button', { name: 'Close', exact: true }).click();
  await toggle('Overview');

  await go('Worker bills');
  const survivingBill = page.getByRole('button', { name: 'WB-2', exact: true });
  const billNode = await survivingBill.elementHandle();
  let resume;
  const paused = new Promise((resolve) => {
    resume = resolve;
  });
  pauseReads(() => paused);
  await page.getByRole('button', { name: /WB-1/ }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete bill' }).click();
  await expect.poll(() => reads).toEqual(['challans', 'bills', 'bills']);
  // Keep the surviving row and the search in the DOM while the post-write read is pending.
  expect(await billNode.evaluate((node) => node.isConnected)).toBe(true);
  await expect(page.getByText('Loading production documents…')).toHaveCount(0);
  resume();
  await expect(page.getByRole('button', { name: 'WB-1', exact: true })).toHaveCount(0);
  expect(await sameNode(survivingBill, billNode)).toBe(true);
  await go('Challans');
  await expect.poll(() => reads).toEqual(['challans', 'bills', 'bills', 'challans']);
  expect(await sameNode(challanRow, challanNode)).toBe(true);
  await page.clock.setFixedTime(Date.now() + 61_000);
  await go('Worker bills');
  await expect.poll(() => reads).toEqual(['challans', 'bills', 'bills', 'challans', 'bills']);
  expect(await sameNode(survivingBill, billNode)).toBe(true);
  expect(await page.evaluate(() => window.documentViewStats)).toEqual(instrumentation);

  let finishRefresh;
  pauseReads(
    () =>
      new Promise((resolve) => {
        finishRefresh = resolve;
      }),
  );
  const refresh = activePanel.getByRole('button', { name: 'Refresh records' });
  await refresh.click();
  await expect.poll(() => reads.length).toBe(6);
  await refresh.click();
  await expect(survivingBill).toBeVisible();
  await expect(page.getByText('Loading production documents…')).toHaveCount(0);
  finishRefresh();
  await page.waitForLoadState('networkidle');
  expect(reads).toEqual(['challans', 'bills', 'bills', 'challans', 'bills', 'bills']);
  expect(await sameNode(survivingBill, billNode)).toBe(true);
  expect(await page.evaluate(() => window.documentViewStats)).toEqual(instrumentation);
  expect(documentRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('production document page chrome matches approved record pages at desktop and phone widths', async ({
  page,
}) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Uses authenticated document and reference fixtures');
  const pages = [
    ['productionProductTypes', 'Product types'],
    ['suppliers', 'Suppliers'],
    ['colours', 'Colour library'],
    ['challans', 'Challans'],
    ['worker-bills', 'Worker bills'],
  ];
  const access = { view: true, create: true, edit: true, format: true, print: true, export: true };
  await documentFixtures(
    page,
    Object.fromEntries(pages.slice(0, 3).map(([route]) => [route, access])),
  );
  const captureDir = process.env.WORKSHEET_SCREENSHOT_DIR;
  const captureBaseline = !!captureDir && process.env.WORKSHEET_CAPTURE_BASELINE === '1';
  const style = (locator, props) =>
    locator.evaluate(
      (element, names) => names.map((name) => getComputedStyle(element)[name]),
      props,
    );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    let reference;
    for (const [route, title] of pages) {
      const documents = route === 'challans' || route === 'worker-bills';
      await page.goto(
        documents
          ? '/production-challan.html?visual=' + route + '#' + route
          : '/fabric.html?live=1#' + route,
      );
      const main = page.locator('main.fabric-main');
      const header = main.locator('.fabric-page-header:visible');
      const actions = main.locator('.fabric-actions:visible');
      const banner = main.locator('.access-info');
      const refresh = main.getByRole('button', { name: 'Refresh records' });
      const search = actions.getByRole('searchbox');
      const overviewSearch = main.getByRole('searchbox');
      const toggle = header.locator('.fabric-view-toggle');
      await expect(header.getByRole('heading', { name: title, exact: true })).toBeVisible();
      if (!captureBaseline || !documents) {
        await expect(banner).toHaveText(/Signed in · Fabric, Colours and Production connected/);
        await expect(header.locator('h1 + p')).toBeVisible();
        await expect(refresh).toBeVisible();
        await expect(
          main.getByText('Live Supabase records · saved changes are shared', { exact: false }),
        ).toBeVisible();
      } else {
        await expect(main.getByRole('table', { name: title, exact: true })).toBeVisible();
      }
      if (captureDir)
        await main.screenshot({
          path: captureDir + '/' + route + '-' + width + '-overview.png',
          animations: 'disabled',
        });

      const chrome = async () => ({
        header: await style(header, ['gap', 'marginBottom', 'flexWrap']),
        title: await style(header.locator('h1'), ['fontSize', 'fontWeight', 'letterSpacing']),
        toggle: await style(toggle, ['backgroundColor', 'borderRadius', 'padding']),
        actions: await style(actions, ['gap', 'marginBottom', 'flexWrap']),
        search: await style(search, ['fontSize', 'padding', 'borderRadius', 'width']),
        banner: await style(banner, ['fontSize', 'padding', 'marginBottom']),
        refresh: await style(refresh, ['fontSize', 'padding', 'borderRadius']),
      });
      if (!captureBaseline) {
        await overviewSearch.fill('no-such-record-123456789');
        await expect(main.getByText('No matching records', { exact: true })).toBeVisible();
        await main.getByRole('button', { name: 'Clear search' }).click();
      }
      await toggle.getByRole('button', { name: 'Sheet' }).click();
      await expect(main.getByRole('combobox', { name: 'Sheet zoom' })).toBeVisible();
      if (captureDir)
        await main.screenshot({
          path: captureDir + '/' + route + '-' + width + '-sheet.png',
          animations: 'disabled',
        });
      if (captureBaseline) continue;

      const sheetChrome = await chrome();
      reference ??= sheetChrome;
      expect(sheetChrome, title + ' Sheet at ' + width).toEqual(reference);
      const bounds = await actions.boundingBox();
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
  }
});
