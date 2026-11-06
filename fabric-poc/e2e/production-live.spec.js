import { test, expect } from '@playwright/test';
import { productionFixture } from '../tests/fixtures/production-live.js';

async function liveWorkspace(page, { rejectMovement = false } = {}) {
  const snapshot = productionFixture(),
    calls = [];
  const actor = '00000000-0000-4000-8000-000000000003';
  const encode = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', aal: 'aal2', exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic`;
  await page.addInitScript(
    ({ token, actor }) =>
      localStorage.setItem(
        'sb-example-auth-token',
        JSON.stringify({
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
        }),
      ),
    { token, actor },
  );
  await page.route('https://example.invalid/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    const args = route.request().postDataJSON();
    calls.push({ name, args });
    let body;
    if (name === 'erp_account_security') body = { enabled: true, ready: true };
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
          ].map((k) => [k, { view: true, edit: true, create: true }]),
        ),
      };
    else if (name === 'erp_production_workspace') body = snapshot;
    else if (name === 'erp_edit_production_task') {
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
    } else throw Error(`Unexpected live request: ${name}`);
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
  await page.reload();
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
  await page.getByRole('button', { name: 'Edit →', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit item', exact: true })).toBeVisible();
  await expect(page.getByLabel('Variant 1', { exact: true })).toHaveValue('101');
  await page.getByLabel('Batch number', { exact: true }).fill('000987');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect
    .poll(() => calls.filter((c) => c.name === 'erp_save_production_setup').length)
    .toBe(1);
  const changes = calls.find((c) => c.name === 'erp_save_production_setup').args.p_changes;
  expect(changes.some((c) => c.table === 'variant')).toBe(false);
  expect(changes.find((c) => c.table === 'item').values.batch_number).toBe('000987');
});
