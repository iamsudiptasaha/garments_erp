import { test, expect } from '@playwright/test';
import { productionFixture } from '../tests/fixtures/production-live.js';

async function liveWorkspace(
  page,
  {
    rejectMovement = false,
    authenticated = true,
    actor = '00000000-0000-4000-8000-000000000003',
    overviewPreferences = new Map(),
  } = {},
) {
  const snapshot = productionFixture(),
    calls = [];
  let studioPreferences = {};
  const encode = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', aal: 'aal2', exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic`;
  const session = {
    access_token: token,
    refresh_token: 'synthetic-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: actor,
      email: 'operator@example.invalid',
      aud: 'authenticated',
      role: 'authenticated',
    },
  };
  if (authenticated)
    await page.addInitScript(
      (session) => localStorage.setItem('sb-example-auth-token', JSON.stringify(session)),
      session,
    );
  await page.route('https://example.invalid/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    const args = route.request().postDataJSON();
    calls.push({ name, args });
    let body;
    if (name === 'settings') body = { external: {} };
    else if (name === 'token') body = session;
    else if (name === 'erp_account_security') body = { enabled: true, ready: true };
    else if (name === 'erp_access_snapshot')
      body = {
        actor,
        enabled: true,
        administrator: false,
        permissions: Object.fromEntries(
          [
            'productionJobs',
            'productionItems',
            'productionDesigns',
            'productionStages',
            'productionFlags',
            'productionGenders',
            'productionStatuses',
          ].map((k) => [k, { view: true, edit: true, create: true }]),
        ),
      };
    else if (name === 'erp_production_workspace') body = snapshot;
    else if (name === 'erp_grid_preferences' && args.p_grid === 'workspace-navigation') body = {};
    else if (name === 'erp_grid_preferences' && args.p_grid === 'overview-production-statuses') {
      expect(args.p_owner).toBe(actor);
      body = { ...overviewPreferences.get(actor), ...args.p_patch };
      if (args.p_patch) overviewPreferences.set(actor, body);
    } else if (name === 'erp_grid_preferences' && args.p_grid === 'overview-productionItems') {
      expect(args.p_owner).toBe(actor);
      body = {};
    } else if (name === 'erp_grid_preferences') {
      expect(args).toMatchObject({ p_grid: 'production-studio', p_owner: actor });
      if (args.p_patch) studioPreferences = { ...studioPreferences, ...args.p_patch };
      body = studioPreferences;
    } else if (name === 'erp_edit_production_task') {
      snapshot.production_records[0].assignees = args.p_assignees;
      snapshot.production_records[0].flags = args.p_flags;
      snapshot.production_records[0].statuses[0].item_status_list_id = args.p_status;
      snapshot.production_records[0].revision += '-saved';
      snapshot.job[0].due_date = args.p_due;
      snapshot.production_checklist = [
        { id: '141', item_id: snapshot.item[0].id, ...args.p_checklist },
      ];
      body = snapshot;
    } else if (name === 'erp_move_production') {
      if (rejectMovement)
        return route.fulfill({
          status: 409,
          json: { code: '40001', message: 'Current visit changed. Reload before handing over.' },
        });
      const payload = args.p_payload;
      snapshot.job[0].stage_id = payload.to_stage_id;
      snapshot.stage_pieces.forEach((p) => {
        const v = snapshot.variant_item_per_job.find((v) => v.id === p.variant_item_per_job_id);
        p.pieces_stock_in = payload.pieces.find(
          (q) => q.variant_item_id === v.variant_item_id,
        ).pieces_stock_out;
      });
      snapshot.production_records[0].movements = [
        { id: '151', action: 'advance', created_at: '2026-11-06T00:00:00Z' },
      ];
      body = { production_id: '31', job_id: '41', transition_id: '151' };
    } else if (name === 'erp_save_production_setup') {
      for (const change of args.p_changes) {
        const row = snapshot[change.table].find((r) => r.id === change.id);
        if (row) Object.assign(row, change.values);
      }
      body = snapshot;
    } else if (['erp_file_registry', 'erp_file_routes', 'erp_file_list'].includes(name)) body = [];
    else throw Error(`Unexpected live request: ${name}`);
    await route.fulfill({ json: body });
  });
  return { snapshot, calls };
}
test.beforeEach(async ({ baseURL }) => {
  test.skip(
    !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname),
    'Synthetic transport is local-only',
  );
});
test('live Task Board loads without Fabric permission and saves shared status across all views', async ({
  page,
}) => {
  const { calls } = await liveWorkspace(page);
  await page.goto('/fabric.html?live=1#productionTaskBoard');
  await expect(page.getByRole('heading', { name: 'Task Board', exact: true })).toBeVisible();
  await expect(page.getByText('This section is not connected yet')).toHaveCount(0);
  for (const mode of ['List', 'Table', 'Kanban'])
    await page.getByRole('tab', { name: mode, exact: true }).click();
  await page.getByText('Cotton polo · Body', { exact: true }).first().click();
  await page.getByLabel('Detail job status', { exact: true }).selectOption('Complete');
  await expect
    .poll(() => calls.filter((c) => c.name === 'erp_edit_production_task').length)
    .toBe(1);
  await expect
    .poll(() =>
      calls.some(
        ({ name, args }) =>
          name === 'erp_grid_preferences' && args.p_patch?.config?.mode === 'kanban',
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Kanban', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('Complete', { exact: true }).first()).toBeVisible();
  expect(calls.some((c) => c.name === 'erp_fabric_snapshot')).toBe(false);
  expect(
    await page.evaluate(() => localStorage.getItem('garments-fabric-workspace-v1')),
  ).toBeNull();
});
test('live Update Tasks sends every variant once, including zero, and permits stage skipping', async ({
  page,
}) => {
  const { calls } = await liveWorkspace(page);
  await page.goto('/fabric.html?live=1#productionUpdateTaskStatus');
  await expect(page.getByLabel('Next stage')).toBeVisible();
  await page.getByLabel('Next stage').selectOption('Stitching');
  const inputs = page.locator('.size-entry-grid input');
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).fill('0');
  await page
    .getByLabel('Handed over by', { exact: true })
    .selectOption({ label: 'Asha Das (EMP-72)' });
  await expect(
    page.getByRole('button', { name: 'Hand over to Stitching', exact: true }),
  ).toBeDisabled();
  await inputs.nth(1).fill('19');
  await page.getByRole('button', { name: 'Hand over to Stitching', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Handed over', exact: true })).toBeVisible();
  const moves = calls.filter((c) => c.name === 'erp_move_production');
  expect(moves).toHaveLength(1);
  expect(moves[0].args.p_payload).toMatchObject({
    to_stage_id: '3',
    expected_transition_id: '0',
    verified_by: '72',
    pieces: [
      { variant_item_id: '111', item_size_list_id: '91', pieces_stock_out: 0 },
      { variant_item_id: '112', item_size_list_id: '91', pieces_stock_out: 19 },
    ],
  });
  await page.reload();
  await expect(page.locator('.operator-context')).toContainText('Stitching');
  await expect(page.locator('.size-entry-grid small').first()).toHaveText('In: 0');
});
test('failed live handover keeps entered numbers and reports the server error', async ({
  page,
}) => {
  await liveWorkspace(page, { rejectMovement: true });
  await page.goto('/fabric.html?live=1#productionUpdateTaskStatus');
  const inputs = page.locator('.size-entry-grid input');
  await inputs.nth(0).fill('7');
  await inputs.nth(1).fill('9');
  await page
    .getByLabel('Handed over by', { exact: true })
    .selectOption({ label: 'Asha Das (EMP-71)' });
  await page.getByRole('button', { name: 'Hand over to Printing', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Current visit changed');
  await expect(page.getByRole('heading', { name: 'Handed over', exact: true })).toHaveCount(0);
  await expect(inputs.nth(0)).toHaveValue('7');
  await expect(
    page.getByRole('button', { name: 'Hand over to Printing', exact: true }),
  ).toBeEnabled();
});
test('live Items selects shared variants and persists batch number through the setup command', async ({
  page,
}) => {
  const { calls } = await liveWorkspace(page);
  await page.goto('/fabric.html?live=1#productionItems');
  await page
    .getByRole('table', { name: 'Items', exact: true })
    .getByRole('row')
    .nth(1)
    .getByRole('button')
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Edit item', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload item image' })).toBeVisible();
  await expect(page.getByLabel('Variant 1', { exact: true })).toHaveValue('101');
  await page.getByLabel('Batch number', { exact: true }).fill('000987');
  await page.getByRole('button', { name: 'Review item', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm save' }).click();
  await expect
    .poll(() => calls.filter((c) => c.name === 'erp_save_production_setup').length)
    .toBe(1);
  const changes = calls.find((c) => c.name === 'erp_save_production_setup').args.p_changes;
  expect(changes.some((c) => c.table === 'variant')).toBe(false);
  expect(changes.find((c) => c.table === 'item').values.batch_number).toBe('000987');
});

test('live floor QR enters directly and shares the authenticated Update Tasks form', async ({
  page,
  context,
}, testInfo) => {
  const { calls } = await liveWorkspace(page);
  const updateUrl = '/fabric.html?live=1#productionUpdateTaskStatus';
  const floorUrl = '/fabric.html?live=1&floor=1&task=31#productionUpdateTaskStatus';
  await page.goto(updateUrl);
  const picker = page.getByRole('combobox', { name: 'Design / task', exact: true });
  await expect(picker).toBeVisible();
  const documents = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'document' && request.frame() === page.mainFrame())
      documents.push(request.url());
  });
  const shell = await page.locator('.fabric-shell').elementHandle();
  const sidebar = await page.locator('#workspace-sidebar').elementHandle();
  const link = page.getByRole('link', { name: /Open standalone floor form/ });
  await expect(link).toHaveAttribute('href', floorUrl);
  await link.click();
  await expect(page).toHaveURL(new RegExp('floor=1&task=31'));
  await expect(picker).toHaveCount(0);
  await expect(page.locator('.operator-context')).toContainText('Cotton polo');
  await page.goBack();
  await expect(picker).toBeVisible();
  await page.goForward();
  await expect(picker).toHaveCount(0);
  await expect(page.locator('.size-entry-grid input')).toHaveCount(2);
  expect(documents).toEqual([]);
  expect(await shell.evaluate((node) => node === document.querySelector('.fabric-shell'))).toBe(
    true,
  );
  expect(
    await sidebar.evaluate((node) => node === document.querySelector('#workspace-sidebar')),
  ).toBe(true);

  const direct = await context.newPage();
  try {
    await liveWorkspace(direct);
    await direct.setViewportSize({ width: 390, height: 844 });
    await direct.goto(floorUrl);
    await expect(direct.locator('.operator-context')).toContainText('Cotton polo');
    await expect(direct.getByRole('combobox', { name: 'Design / task', exact: true })).toHaveCount(
      0,
    );
    expect(await direct.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await direct.screenshot({
      path: testInfo.outputPath('floor-qr-mobile.png'),
      animations: 'disabled',
    });
    await direct.reload();
    await expect(direct.locator('.size-entry-grid input')).toHaveCount(2);
    await direct.goto(floorUrl.replace('task=31', 'task=unknown'));
    await expect(direct.getByRole('heading', { name: 'Task unavailable' })).toBeVisible();
  } finally {
    await direct.close();
  }

  const inputs = page.locator('.size-entry-grid input');
  await inputs.nth(0).fill('7');
  await page
    .getByLabel('Handed over by', { exact: true })
    .selectOption({ label: 'Asha Das (EMP-71)' });
  const submit = page.getByRole('button', { name: 'Hand over to Printing', exact: true });
  await expect(submit).toBeDisabled();
  await inputs.nth(1).fill('9');
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Handed over', exact: true })).toBeVisible();
  expect(calls.filter((call) => call.name === 'erp_move_production')).toHaveLength(1);
});

test('signed-out live floor QR retains the task URL through the sign-in document', async ({
  page,
}) => {
  const { calls } = await liveWorkspace(page, { authenticated: false });
  const path = '/fabric.html?live=1&floor=1&task=31#productionUpdateTaskStatus';
  await page.goto(path);
  const signIn = page.getByRole('heading', { name: 'Sign in', exact: true });
  await expect(signIn).toBeVisible();
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(path);
  expect(calls.some(({ name }) => name === 'erp_production_workspace')).toBe(false);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('operator@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new URL(path, page.url()).href);
  await expect(page.locator('.operator-context')).toContainText('Cotton polo');
  await expect(page.getByRole('combobox', { name: 'Design / task', exact: true })).toHaveCount(0);
});

test('Job statuses restores existing account preferences across browsers and isolates another account', async ({
  browser,
}) => {
  const overviewPreferences = new Map();
  const actor = '00000000-0000-4000-8000-000000000003';
  const first = await browser.newPage();
  const second = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const other = await browser.newPage();
  try {
    const url = '/fabric.html?live=1#productionStatuses';
    await liveWorkspace(first, { actor, overviewPreferences });
    await first.goto(url);
    await first.getByRole('searchbox', { name: 'Search Job statuses' }).fill('complete');
    await expect.poll(() => overviewPreferences.get(actor)?.search).toBe('complete');
    await expect(first.getByRole('table', { name: 'Job statuses' }).getByRole('row')).toHaveCount(
      2,
    );
    await liveWorkspace(second, { actor, overviewPreferences });
    await second.goto(url);
    await expect(second.getByRole('searchbox', { name: 'Search Job statuses' })).toHaveValue(
      'complete',
    );
    await expect(second.getByRole('table', { name: 'Job statuses' }).getByRole('row')).toHaveCount(
      2,
    );
    await liveWorkspace(other, {
      actor: '00000000-0000-4000-8000-000000000004',
      overviewPreferences,
    });
    await other.goto(url);
    await expect(other.getByRole('searchbox', { name: 'Search Job statuses' })).toHaveValue('');
    await expect(other.getByRole('table', { name: 'Job statuses' }).getByRole('row')).toHaveCount(
      3,
    );
  } finally {
    await Promise.all([first.close(), second.close(), other.close()]);
  }
});
