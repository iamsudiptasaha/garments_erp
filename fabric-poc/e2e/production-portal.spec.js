import { test, expect } from '@playwright/test';
import { initialFabric } from '../src/fabric/domain.js';
import { initialAccess } from '../src/admin/model.js';
const store = 'garments-fabric-workspace-v1';
test.beforeEach(async ({ page, baseURL }) => {
  test.skip(
    !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname),
    'Local production preview only.',
  );
  await page.goto('/fabric.html');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/fabric.html#productionTaskBoard');
});
test('portal Production navigation opens Task Board using real preview records', async ({
  page,
}) => {
  await expect(
    page
      .getByRole('navigation', { name: 'Production pages' })
      .getByRole('button', { name: 'Task Board', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Task Board', exact: true })).toBeVisible();
  await expect(page.getByText('SC-101', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('SC-26101', { exact: true })).toHaveCount(0);
  for (const name of ['List', 'Table', 'Kanban']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }
  await page
    .getByRole('navigation', { name: 'Production pages' })
    .getByRole('button', { name: 'Update Tasks', exact: true })
    .click();
  await expect(page.getByRole('combobox', { name: 'Design / task', exact: true })).toBeVisible();
  await expect(page.locator('.operator-intro h2')).toHaveCSS('color', 'rgb(36, 62, 83)');
  await expect(page.locator('.operator-intro p')).toHaveCSS('color', 'rgb(108, 133, 152)');
  await expect(page.locator('.size-entry-grid input')).toHaveCount(3);
  await expect(page.locator('.variant-entry header strong')).toHaveText('Plain');
  await expect(page.locator('.size-entry-grid small').first()).toHaveText('In: 100');
  await expect(page.locator('.size-entry-grid small').nth(1)).toHaveText('In: 120');
  await expect(page.getByLabel('Next stage')).toHaveValue('Stitching');
});
test('portal handover persists actual linked job quantities and retains challan/job identities', async ({
  page,
}) => {
  await page
    .getByRole('navigation', { name: 'Production pages' })
    .getByRole('button', { name: 'Update Tasks', exact: true })
    .click();
  const inputs = page.locator('.size-entry-grid input');
  await inputs.nth(0).fill('7');
  await inputs.nth(1).fill('0');
  await expect(page.getByRole('button', { name: /Hand over to/ })).toBeDisabled();
  await inputs.nth(2).fill('9');
  await page
    .getByLabel('Handed over by', { exact: true })
    .selectOption({ label: 'Workspace owner' });
  await page.getByRole('button', { name: 'Hand over to Stitching', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Handed over', exact: true })).toBeVisible();
  const data = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).data, store);
  const task = data.production_task_board_preview[0];
  expect(task.stage).toBe('Stitching');
  expect(task.handovers).toHaveLength(1);
  expect(data.job.find((j) => j.id === task.currentJobId).stage_id).toBe('prod-stage-stitch');
  const link = data.variant_item_per_job.find((v) => v.job_id === 'prod-job-print');
  expect(
    data.stage_pieces
      .filter((p) => p.variant_item_per_job_id === link.id)
      .map((p) => p.pieces_stock_out),
  ).toEqual([7, 0, 9]);
  expect(data.job.some((j) => j.id === 'prod-job-cut')).toBe(true);
  await page.reload();
  await expect(page.locator('.operator-context')).toContainText('Stitching');
  await expect(page.locator('.size-entry-grid small').first()).toHaveText('In: 7');
  await page
    .getByRole('navigation', { name: 'Production pages' })
    .getByRole('button', { name: 'Task Board', exact: true })
    .click();
  await expect(page.locator('.stage-cell').first()).toHaveText('Stitching');
});

test('portal floor route shares navigation and keeps the focused form with actual item dimensions', async ({
  page,
}) => {
  await page.goto('/fabric.html?floor=1&task=production-prod-ip-1#productionUpdateTaskStatus');
  await expect(
    page
      .getByRole('navigation', { name: 'Production pages' })
      .getByRole('button', { name: 'Update Tasks' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('combobox', { name: 'Design / task', exact: true })).toHaveCount(0);
  await expect(page.locator('.operator-context')).toContainText('SC-101');
  await expect(page.locator('.size-entry-grid input')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('existing Production permissions govern new portal screens and block handovers', async ({
  page,
}) => {
  await page.evaluate((access) => {
    access.roles.find((r) => r.id === 'admin').permissions.productionJobs = { view: true };
    localStorage.setItem('garments-access-preview-v1', JSON.stringify(access));
  }, initialAccess());
  await page.goto('/fabric.html#productionUpdateTaskStatus');
  await page.reload();
  for (const input of await page.locator('.size-entry-grid input').all()) await input.fill('5');
  await page
    .getByLabel('Handed over by', { exact: true })
    .selectOption({ label: 'Workspace owner' });
  await expect(page.getByRole('button', { name: /Hand over to/ })).toBeDisabled();
  expect(
    await page.evaluate(() => localStorage.getItem('garments-fabric-workspace-v1')),
  ).toBeNull();
});

test('Production navigation prioritizes daily work and keeps history read-only', async ({
  page,
}) => {
  const nav = page.getByRole('navigation', { name: 'Production pages' });
  await expect(nav.getByRole('button').nth(0)).toHaveText('Task Board');
  await expect(nav.getByRole('button').nth(1)).toHaveText('Update Tasks');
  await expect(nav.getByRole('button', { name: 'Item parts', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Item sizes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save view', exact: true })).toHaveCount(0);
  await page.locator('[data-task] .task-title').first().click();
  await expect(page.getByLabel('Planned pieces', { exact: true })).toHaveAttribute('readonly', '');
  await page.keyboard.press('Escape');
  await nav.getByRole('button', { name: 'Job history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Job history', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Create.*job/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'SC-101-BODY-CUT', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Recorded pieces');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Flags and Gender pages save references and survive reload', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Production pages' });
  await nav.getByRole('button', { name: 'Flags', exact: true }).click();
  await page.getByRole('button', { name: '+ Add flag', exact: true }).click();
  await page.getByLabel('Flag name', { exact: true }).fill('Awaiting trim approval');
  await page.getByRole('button', { name: /Review/ }).click();
  await page.getByRole('button', { name: /Confirm.*save|Save flag|Save record/i }).click();
  await page.reload();
  await expect(page.getByText('Awaiting trim approval', { exact: true }).first()).toBeVisible();
  await nav.getByRole('button', { name: 'Gender', exact: true }).click();
  await page.getByRole('button', { name: '+ Add gender', exact: true }).click();
  await page.getByLabel('Gender name', { exact: true }).fill('Test gender');
  await page.getByRole('button', { name: /Review/ }).click();
  await page.getByRole('button', { name: /Confirm.*save|Save gender|Save record/i }).click();
  const data = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).data, store);
  expect(data.flags_list.some((f) => f.name === 'Awaiting trim approval')).toBe(true);
  expect(data.gender.some((g) => g.name === 'Test gender')).toBe(true);
  await nav.getByRole('button', { name: 'Task Board', exact: true }).click();
  await page.locator('[data-task] .task-title').first().click();
  await expect(page.getByLabel('Awaiting trim approval', { exact: true })).toBeVisible();
});

test('Task Board starts a prepared item part once at the first stage', async ({ page }) => {
  const data = initialFabric();
  data.variant_item.push({
    id: 'test-sleeve-variant',
    item_part_id: 'prod-ip-2',
    variant_id: data.variant[0].id,
    lab_dip_id: null,
  });
  data.item_cut_ratio = data.item_size_list.map((s, i) => ({
    id: `test-ratio-${i}`,
    item_size_list_id: s.id,
    pieces: [10, 12, 8][i],
  }));
  await page.evaluate(
    ({ key, data }) =>
      localStorage.setItem(key, JSON.stringify({ version: 1, data, preferences: {} })),
    { key: store, data },
  );
  await page.reload();
  await page.getByRole('button', { name: '+ Start production', exact: true }).click();
  await page.getByRole('combobox', { name: 'Start item / part', exact: true }).fill('Sleeve');
  await page.keyboard.press('Enter');
  await page.getByLabel('Started by', { exact: true }).selectOption({ label: 'Workspace owner' });
  await page.getByRole('button', { name: 'Start at Cutting', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-task] .task-title')).toHaveCount(2);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).data, store);
  expect(saved.job.filter((j) => j.item_part_id === 'prod-ip-2')).toHaveLength(1);
  await page.goto('/fabric.html?floor=1&task=production-prod-ip-2#productionUpdateTaskStatus');
  await expect(page.locator('.operator-context')).toContainText('Cutting');
  await expect(page.locator('.size-entry-grid small')).toHaveText(['In: 10', 'In: 12', 'In: 8']);
});

test('Kanban lanes stack vertically and fill available workspace, with stage type and image controls', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click();
  const geometry = await page
    .locator('.production-lane')
    .first()
    .evaluate((lane) => {
      const board = lane.parentElement;
      const header = lane.querySelector('.lane-header').getBoundingClientRect();
      const cards = lane.querySelector('.lane-cards').getBoundingClientRect();
      return {
        direction: getComputedStyle(lane).flexDirection,
        headerBottom: header.bottom,
        cardsTop: cards.top,
        width: board.getBoundingClientRect().width,
        available: board.parentElement.clientWidth - 56,
      };
    });
  expect(geometry.direction).toBe('column');
  expect(geometry.cardsTop).toBeGreaterThanOrEqual(geometry.headerBottom);
  expect(geometry.width).toBeGreaterThanOrEqual(geometry.available - 1);
  await page.getByRole('button', { name: 'Card fields', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Item image', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Stage type', exact: true }).check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.production-card .item-image-placeholder')).toBeVisible();
  await expect(page.locator('.card-stage-type')).toHaveText('Production');
  await page.getByRole('button', { name: /^Group/ }).click();
  await page.getByLabel('Grouping level 1', { exact: true }).selectOption('stageType');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.lane-header')).toContainText('Production');
});

test('untracked handover requires no quantities and restores dimensions at next tracked stage', async ({
  page,
}) => {
  const data = initialFabric();
  data.stage.find((s) => s.id === 'prod-stage-print').track_pieces = false;
  await page.evaluate(
    ({ key, data }) =>
      localStorage.setItem(key, JSON.stringify({ version: 1, data, preferences: {} })),
    { key: store, data },
  );
  await page.goto('/fabric.html#productionUpdateTaskStatus');
  await page.reload();
  await expect(page.locator('.size-entry-grid input')).toHaveCount(0);
  await page
    .getByLabel('Handed over by', { exact: true })
    .selectOption({ label: 'Workspace owner' });
  await page.getByRole('button', { name: 'Hand over to Stitching', exact: true }).click();
  await page.reload();
  await expect(page.locator('.size-entry-grid input')).toHaveCount(3);
  await expect(page.locator('.handover-form button[type=submit]')).toBeDisabled();
});

test('rectification restores original incoming counts and movement dates use India business date', async ({
  page,
}) => {
  const data = initialFabric();
  data.employee.push({
    ...data.employee[0],
    id: 'inactive-test',
    name: 'Inactive operator',
    is_active: false,
  });
  await page.evaluate(
    ({ key, data }) =>
      localStorage.setItem(key, JSON.stringify({ version: 1, data, preferences: {} })),
    { key: store, data },
  );
  await page.goto('/fabric.html#productionUpdateTaskStatus');
  await page.reload();
  await expect(
    page.getByLabel('Handed over by').getByRole('option', { name: 'Inactive operator' }),
  ).toHaveCount(0);
  for (const input of await page.locator('.size-entry-grid input').all()) await input.fill('7');
  await page
    .getByLabel('Handed over by', { exact: true })
    .selectOption({ label: 'Workspace owner' });
  await page.getByRole('button', { name: 'Hand over to Stitching', exact: true }).click();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  let saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).data, store);
  expect(saved.job.find((j) => j.latest).start_date).toBe(today);
  expect(saved.job.find((j) => j.id === 'prod-job-print').complete_date).toBe(today);
  await page.reload();
  await page.getByLabel('Next stage').selectOption('Printing');
  await page.getByLabel('Rectification reason').fill('Recheck print');
  for (const input of await page.locator('.size-entry-grid input').all()) await input.fill('2');
  await page
    .getByLabel('Handed over by', { exact: true })
    .selectOption({ label: 'Workspace owner' });
  await page.getByRole('button', { name: 'Hand over to Printing', exact: true }).click();
  await page.reload();
  await expect(page.locator('.size-entry-grid small')).toHaveText(['In: 100', 'In: 120', 'In: 80']);
  saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).data, store);
  expect(saved.job.find((j) => j.latest).id).toBe('prod-job-print');
});
