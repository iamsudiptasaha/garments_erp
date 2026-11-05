import { test, expect } from '@playwright/test';
const key = 'garments.production-studio.v1';
const state = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
async function groupBy(page, value) {
  await page.getByRole('button', { name: /^Group/ }).click();
  await page.getByLabel('Grouping level 1').selectOption(value);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}
async function ungroup(page) {
  await page.getByRole('button', { name: /^Group/ }).click();
  await page.getByLabel('Remove grouping 1').click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  const target = process.env.E2E_BASE_URL;
  test.skip(
    !!target && !['127.0.0.1', 'localhost'].includes(new URL(target).hostname),
    'Prototype is local-only and excluded from deployment builds',
  );
  await page.goto('/production-prototype.html');
});
test('three views share 50 fixtures and make no Supabase requests', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const external = [];
  page.on('request', (request) => {
    if (/supabase/.test(request.url())) external.push(request.url());
  });
  await expect(page.locator('[data-task]')).toHaveCount(50);
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await expect(page.locator('.grid-scroll')).toHaveClass(/table/);
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click();
  await expect(page.locator('[data-card]')).toHaveCount(50);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
test('inline changes synchronize across List, Table, Kanban and reload', async ({ page }) => {
  await page.getByLabel('Status for production-1', { exact: true }).selectOption('Redo');
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await expect(page.getByLabel('Status for production-1', { exact: true })).toHaveValue('Redo');
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click();
  await groupBy(page, 'status');
  await expect(page.locator('[data-card="production-1"] .status-pill')).toHaveText('Redo');
  await page.reload();
  expect((await state(page)).tasks[0].status).toBe('Redo');
});
test('hierarchical List expands read-only historical attempts', async ({ page }) => {
  await page.getByLabel('Expand jobs for production-1', { exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(3);
  await expect(page.locator('.history-row select')).toHaveCount(0);
  await page.getByLabel('Expand jobs for production-1', { exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(0);
});
test('search, multiple AND filters, and empty-state recovery', async ({ page }) => {
  await page.getByLabel('Search productions').fill('linen');
  await expect(page.locator('[data-task]')).toHaveCount(5);
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('button', { name: 'Add filter rule' }).click();
  await page.getByLabel('Filter value').selectOption('In process');
  await page.getByRole('button', { name: 'Add filter rule' }).click();
  await page.getByLabel('Filter field').nth(1).selectOption('priority');
  await page.getByLabel('Filter value').nth(1).selectOption('High');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('[data-task]')).toHaveCount(1);
  await page.getByLabel('Search productions').fill('no-such-garment');
  await expect(page.getByRole('heading', { name: 'No productions found' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('[data-task]')).toHaveCount(50);
});
test('nested grouping collapses groups in List and Kanban', async ({ page }) => {
  await page.getByRole('button', { name: /^Group/ }).click();
  await page.getByRole('button', { name: 'Add grouping level' }).click();
  await page.getByLabel('Grouping level 2').selectOption('brand');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.group-depth-1')).not.toHaveCount(0);
  const group = page.locator('.group-row button').first();
  await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click();
  const subgroup = page.locator('.kanban-subgroup').first();
  await subgroup.click();
  await expect(subgroup).toHaveAttribute('aria-expanded', 'false');
});
test('table supports bulk edits, visibility, order and resizing', async ({ page }) => {
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await ungroup(page);
  await page.getByLabel('Select all visible productions').check();
  await page.getByLabel('Bulk priority').selectOption('High');
  expect((await state(page)).tasks.every((t) => t.priority === 'High')).toBe(true);
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.getByLabel('Planned pieces', { exact: true }).check();
  await page.getByLabel('Move due left').click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Planned pieces' })).toBeVisible();
  const config = (await state(page)).config;
  expect(config.order.indexOf('due')).toBeLessThan(config.order.indexOf('priority'));
  const separator = page.getByRole('separator', {
    name: 'Resize Production / item part',
    exact: true,
  });
  const box = await separator.boundingBox();
  await page.mouse.move(box.x + 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 75, box.y + 10, { steps: 8 });
  await page.mouse.up();
  expect((await state(page)).config.sizing.name).toBeGreaterThan(390);
});
test('multi-sort and saved views restore full configuration independently of data', async ({
  page,
}) => {
  await page.getByRole('button', { name: /^Sort/ }).click();
  await page.getByRole('button', { name: 'Add sort rule' }).click();
  await page.getByLabel('Sort field 1').selectOption('brand');
  await page.getByRole('button', { name: 'Add sort rule' }).click();
  await page.getByLabel('Sort field 2').selectOption('due');
  await page.getByLabel('Sort direction 2').selectOption('desc');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByLabel('Search productions').fill('linen');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByLabel('View name').fill('Linen delivery');
  await page.getByRole('button', { name: 'Save as new view' }).click();
  await page.getByLabel('Status for production-1', { exact: true }).selectOption('Redo');
  await page.getByLabel('Search productions').fill('oxford');
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await page.getByRole('button', { name: 'Linen delivery', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'List', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('Search productions')).toHaveValue('linen');
  const data = await state(page);
  expect(data.config.sorting).toEqual([
    { id: 'brand', desc: false },
    { id: 'due', desc: true },
  ]);
  expect(data.tasks[0].status).toBe('Redo');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Linen delivery', exact: true })).toBeVisible();
});
async function fillHandover(page, value = '12') {
  const form = page.locator('.handover-form');
  for (const input of await form.locator('.size-entry-grid input').all()) await input.fill(value);
  await page.getByLabel('Handed over by', { exact: true }).selectOption('Ananya Sen');
}
test('shared modal edits fields and preserves history through one-time handovers', async ({
  page,
}) => {
  await page.locator('[data-task="production-1"] .task-title').click();
  await page.getByRole('combobox', { name: 'Task assignees' }).fill('Ananya');
  await page.getByRole('listbox').getByRole('option', { name: 'Ananya Sen', exact: true }).click();
  await page.getByLabel('Fabric ready', { exact: true }).check();
  await page.getByLabel('Current stage', { exact: true }).selectOption('Printing');
  await expect(page.getByRole('button', { name: /Hand over to/ })).toBeDisabled();
  await fillHandover(page);
  await page.getByRole('button', { name: 'Hand over to Printing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Handed over', exact: true })).toBeVisible();
  let task = (await state(page)).tasks[0];
  expect(task.stage).toBe('Printing');
  expect(task.attempts).toHaveLength(5);
  expect(task.handovers).toHaveLength(1);
  expect(task.assignees).toContain('Ananya Sen');
  expect(task.flags).toContain('Fabric ready');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByLabel('Current stage', { exact: true }).selectOption('Cutting');
  await expect(page.locator('.size-entry-grid small').first()).toHaveText('In: 12');
  await fillHandover(page, '0');
  await page.getByLabel('Rectification reason').fill('Cut edge needs correction');
  await page.getByRole('button', { name: 'Hand over to Cutting', exact: true }).click();
  task = (await state(page)).tasks[0];
  expect(task.stage).toBe('Cutting');
  expect(task.attempts).toHaveLength(5);
  expect(task.handovers).toHaveLength(2);
});
test('Kanban card field visibility and status drop update the shared dataset', async ({ page }) => {
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click();
  await groupBy(page, 'status');
  await page.getByRole('button', { name: 'Card fields', exact: true }).click();
  await page.getByLabel('Progress', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.card-progress')).toHaveCount(0);
  const source = page.locator('[data-card="production-6"] [role="button"]').first();
  const lane = page
    .locator('.production-lane')
    .filter({ has: page.locator('.lane-header strong', { hasText: /^Complete$/ }) });
  const a = await source.boundingBox();
  const b = await lane.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + 30);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + 30, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 15 });
  await page.mouse.up();
  await expect
    .poll(async () => (await state(page)).tasks.find((t) => t.id === 'production-6').status)
    .toBe('Complete');
});
test('stage drag requires verification before changing a job stage', async ({ page }) => {
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click();
  const before = (await state(page)).tasks.find((t) => t.id === 'production-4');
  const source = page.locator('[data-card="production-4"] [role="button"]').first();
  await source.scrollIntoViewIfNeeded();
  const destination = page
    .locator('.production-lane')
    .filter({ has: page.locator('.lane-header strong', { hasText: /^Pre-production sample$/ }) });
  const a = await source.boundingBox();
  const b = await destination.boundingBox();
  await page.mouse.move(a.x + 70, a.y + 35);
  await page.mouse.down();
  await page.mouse.move(a.x + 90, a.y + 35, { steps: 5 });
  await page.mouse.move(b.x + 100, b.y + 65, { steps: 15 });
  await page.mouse.up();
  expect((await state(page)).tasks.find((t) => t.id === before.id).stage).toBe(before.stage);
  await expect(page.getByRole('dialog', { name: 'Production details' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Update Task Status', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Hand over to/ })).toBeDisabled();
  await fillHandover(page);
  await expect(page.getByRole('button', { name: /Hand over to/ })).toBeEnabled();
  await page.keyboard.press('Escape');
  expect((await state(page)).tasks.find((t) => t.id === before.id).stage).toBe(before.stage);
});
test('mobile layout keeps views and detail controls available', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('tab', { name: 'Table', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await page.locator('[data-task="production-1"] .task-title').click();
  await expect(page.getByLabel('Current stage', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(page.locator('.task-drawer')).toHaveCount(0);
});
test('column header drag and keyboard resizing persist in the shared configuration', async ({
  page,
}) => {
  const stage = page.getByRole('columnheader', { name: 'Current stage' });
  const status = page.getByRole('columnheader', { name: 'Job status' });
  await stage.dragTo(status);
  let config = (await state(page)).config;
  expect(config.order.indexOf('stage')).toBeLessThan(config.order.indexOf('status'));
  const resize = page.getByRole('separator', { name: 'Resize Current stage', exact: true });
  await resize.focus();
  await page.keyboard.press('ArrowRight');
  config = (await state(page)).config;
  expect(config.sizing.stage).toBe(190);
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await expect(
    page.getByRole('separator', { name: 'Resize Current stage', exact: true }),
  ).toHaveAttribute('aria-valuenow', '190');
});
test('saved views can be updated and deleted', async ({ page }) => {
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByLabel('View name').fill('Floor review');
  await page.getByRole('button', { name: 'Save as new view' }).click();
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByRole('button', { name: 'Update current saved view' }).click();
  expect((await state(page)).views[0].config.mode).toBe('table');
  await page.getByRole('button', { name: 'Delete view Floor review', exact: true }).click();
  expect((await state(page)).views).toHaveLength(0);
});
test('canceling a keyboard card drag leaves shared records unchanged', async ({ page }) => {
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click();
  await groupBy(page, 'status');
  const before = (await state(page)).tasks;
  const card = page.locator('[data-card="production-6"] [role="button"]').first();
  await card.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  expect((await state(page)).tasks).toEqual(before);
});

test('Task Board modal allows verified stage skips and shared item checklist edits', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { name: /Task Board/ })).toBeVisible();
  await page.locator('[data-task="production-1"] .task-title').click();
  await expect(page.getByLabel('Planned pieces', { exact: true })).toHaveAttribute('readonly', '');
  await page.getByLabel('Techpack acquired', { exact: true }).selectOption('Complete');
  let data = await state(page);
  expect(data.tasks[0].pieces).toBe(480);
  expect(
    data.tasks
      .filter((t) => t.style === data.tasks[0].style)
      .every((t) => t.checklist['Techpack acquired'] === 'Complete'),
  ).toBe(true);
  await page.getByLabel('Current stage', { exact: true }).selectOption('Stitching');
  await expect(page.getByRole('button', { name: /Hand over to/ })).toBeDisabled();
  expect((await state(page)).tasks[0].stage).toBe(data.tasks[0].stage);
  await fillHandover(page);
  await page.getByRole('button', { name: 'Hand over to Stitching', exact: true }).click();
  data = await state(page);
  expect(data.tasks[0].stage).toBe('Stitching');
  expect(data.tasks[0].attempts).toHaveLength(5);
});

test('operator page and QR share prefilled fields and require every variant', async ({ page }) => {
  await page.getByRole('link', { name: 'Update Task Status', exact: true }).click();
  await expect(page.locator('.operator-design__single-value')).toContainText('SC-26101');
  const inputs = page.locator('.size-entry-grid input');
  expect(await inputs.count()).toBe(8);
  await page.getByLabel('Handed over by', { exact: true }).selectOption('Rahul Das');
  for (let i = 0; i < 7; i++) await inputs.nth(i).fill('0');
  await expect(page.getByRole('button', { name: /Hand over to/ })).toBeDisabled();
  await inputs.nth(7).fill('-1');
  await expect(page.getByRole('button', { name: /Hand over to/ })).toBeDisabled();
  await inputs.nth(7).fill('2.5');
  await expect(page.getByRole('button', { name: /Hand over to/ })).toBeDisabled();
  await inputs.nth(7).fill('999');
  await page.getByRole('button', { name: /Hand over to/ }).click();
  expect((await state(page)).tasks[0].handovers).toHaveLength(1);
  await expect(page.getByRole('button', { name: /Hand over to/ })).toHaveCount(0);
  await page.goto('/production-prototype.html?screen=qr&task=production-1');
  await expect(page.getByLabel('Design / task')).toHaveCount(0);
  await expect(page.getByRole('link')).toHaveCount(0);
  await expect(page.locator('.operator-context')).toContainText('Printing');
  await expect(page.locator('.size-entry-grid small').last()).toHaveText('In: 999');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('design picker supports typed search, keyboard selection and existing tasks only', async ({
  page,
}) => {
  await page.goto('/production-prototype.html?screen=update&task=production-1');
  const picker = page.getByRole('combobox', { name: 'Design / task', exact: true });
  await picker.fill('zzzz-no-such-design');
  await expect(page.getByText('No matching tasks', { exact: true })).toBeVisible();
  await picker.press('Enter');
  await expect(page.locator('.operator-context')).toContainText('SC-26101');
  await picker.fill('SC-26102');
  await picker.press('ArrowDown');
  const label = await page.locator('.operator-design__option--is-focused').textContent();
  await picker.press('Enter');
  await expect(page.locator('.operator-design__single-value')).toHaveText(label);
  await expect(page.locator('.operator-context')).toContainText('SC-26102');
  await expect(page.locator('.size-entry-grid input')).toHaveCount(8);
  await expect(page.locator('.size-entry-grid input').first()).toHaveValue('');
});
