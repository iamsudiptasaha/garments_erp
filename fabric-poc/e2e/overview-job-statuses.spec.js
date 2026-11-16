import { test, expect } from '@playwright/test';
import { initialAccess } from '../src/admin/model.js';

const url = '/fabric.html#productionStatuses';

test('Job statuses Overview opens the existing editor and keeps Sheet separate', async ({
  page,
}) => {
  await page.goto(url);
  const table = page.getByRole('table', { name: 'Job statuses' });
  await expect(table.getByRole('row')).toHaveCount(7);
  const add = page.getByRole('button', { name: '+ Add status' });
  await expect(add).toBeVisible();
  const sheet = page.getByRole('button', { name: 'Sheet', exact: true });
  expect((await add.boundingBox()).y).toBeGreaterThan((await sheet.boundingBox()).y);
  await table
    .getByRole('row', { name: 'Complete', exact: true })
    .getByRole('cell')
    .click({ position: { x: 140, y: 12 } });
  const editor = page.getByRole('dialog');
  await expect(editor.getByLabel('Status name')).toHaveValue('Complete');
  await editor.getByLabel('Status name').fill('Complete pilot');
  await editor.getByRole('button', { name: /Review/ }).click();
  await page.getByRole('button', { name: /Confirm.*save|Save job status|Save record/i }).click();
  await expect(table.getByRole('button', { name: 'Complete pilot' })).toBeVisible();
  const statuses = await page.evaluate(
    () => JSON.parse(localStorage.getItem('garments-fabric-workspace-v1')).data.item_status_list,
  );
  expect(statuses).toHaveLength(6);
  expect(statuses.find(({ id }) => id === 'prod-status-3').status).toBe('Complete pilot');

  await page.getByRole('searchbox', { name: 'Search Job statuses' }).fill('pilot');
  await expect(table.getByRole('row')).toHaveCount(2);
  await page.reload();
  await expect(table.getByRole('row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(table.getByRole('row')).toHaveCount(7);
  await table
    .getByRole('button', { name: /Status/ })
    .first()
    .click();
  await expect(table.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending');
  await table.getByRole('columnheader').getByRole('button').click();
  await expect(table.getByRole('columnheader')).toHaveAttribute('aria-sort', 'descending');

  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('button', { name: '+ Add filter rule' }).click();
  await page.getByRole('textbox', { name: 'Filter value 1' }).fill('redo');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(table.getByRole('row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear all' }).click();
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  await page.getByRole('button', { name: '+ Add grouping level' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await table.getByRole('button', { name: /▸ Redo/ }).click();
  await expect(table.getByRole('button', { name: 'Redo', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Status' })).toBeDisabled();
  await page.getByRole('spinbutton', { name: 'Status width in pixels' }).fill('230');
  await page.getByRole('spinbutton', { name: 'Status width in pixels' }).press('Tab');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(table).toHaveCSS('width', '230px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await sheet.click();
  await expect(page.getByRole('region', { name: 'Job statuses Overview' })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Search Job statuses' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit selected record' })).toBeDisabled();
});

test('Job statuses preserves view-only and denied permissions', async ({ page }) => {
  await page.goto(url);
  for (const view of [true, false]) {
    const access = initialAccess();
    access.roles.find(({ id }) => id === 'admin').permissions.productionStatuses = { view };
    await page.evaluate(
      (data) => localStorage.setItem('garments-access-preview-v1', JSON.stringify(data)),
      access,
    );
    await page.reload();
    await expect(page.getByRole('button', { name: '+ Add status' })).toHaveCount(0);
    const table = page.getByRole('table', { name: 'Job statuses' });
    if (view) {
      await table.getByRole('cell', { name: 'Complete', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } else await expect(table).toHaveCount(0);
  }
});
