import { expect, test } from '@playwright/test';
import { initialAccess } from '../src/admin/model.js';

test.skip(!!process.env.E2E_BASE_URL, 'Uses local inventory fixtures and roles');

const pages = [
  ['materialStock', 'Stock available'],
  ['materialMovements', 'Movement history'],
  ['materials', 'Materials'],
  ['materialSuppliers', 'Material suppliers'],
  ['materialOrders', 'Material purchase orders'],
  ['materialReceipts', 'Stock receipts'],
  ['materialIssues', 'Stock outward'],
  ['materialCategories', 'Material categories'],
  ['materialUnits', 'Units of measure'],
  ['materialIssueTypes', 'Outward types'],
];

test('all Inventory Overview pages use the shared grid at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [key, title] of pages) {
    await page.goto('/fabric.html#' + key);
    const region = page.getByRole('region', { name: title, exact: true });
    await expect(region).toHaveAttribute('tabindex', '0');
    await expect(region.getByRole('table', { name: title, exact: true })).toBeVisible();
    await expect(
      page.getByRole('searchbox', { name: 'Search ' + title, exact: true }),
    ).toBeVisible();
    await expect(page.locator('.overview-card')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  }
});

test('material orders keep their lines, totals, links and original editor', async ({ page }) => {
  await page.goto('/fabric.html#materialOrders');
  const table = page.getByRole('table', { name: 'Material purchase orders', exact: true });
  const search = page.getByRole('searchbox', { name: 'Search Material purchase orders' });
  await search.fill('no-such-order');
  await expect(table.getByText('No matching records')).toBeVisible();
  await search.fill('Care label');
  const row = table.getByRole('row').filter({ hasText: 'MPO-001' });
  await expect(row.getByRole('cell', { name: '3,000 pieces' })).toBeVisible();
  await row.getByText('See line items (2)').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row.getByRole('link', { name: 'Care label' })).toBeVisible();
  await row.getByRole('cell', { name: '3,000 pieces' }).click();
  await expect(page.getByRole('dialog').getByLabel('Purchase order number')).toHaveValue('MPO-001');
  await page.keyboard.press('Escape');
  await row.getByRole('link').first().click();
  await expect(page).toHaveURL(/#materialSuppliers$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('reconciling a receipt keeps history and prevents reopening the reconciliation for edit', async ({
  page,
}) => {
  await page.goto('/fabric.html#materialStock');
  const stock = page.getByRole('table', { name: 'Stock available' });
  await expect(stock.getByRole('cell', { name: '1,300' })).toBeVisible();
  await stock.getByRole('button', { name: 'Reconcile & close' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Adjustment quantity')).toHaveValue('1300');
  await dialog.getByLabel('Recorded by employee').selectOption('owner');
  await dialog.getByLabel('Reason').fill('Physically reconciled');
  await dialog.getByRole('button', { name: 'Review details →' }).click();
  await dialog.getByRole('button', { name: 'Confirm & save', exact: true }).click();
  await expect(stock.getByRole('cell', { name: 'Closed' })).toBeVisible();
  await expect(stock.getByRole('button', { name: 'Reconcile & close' })).toHaveCount(0);
  await page.goto('/fabric.html#materialIssues');
  const outward = page.getByRole('table', { name: 'Stock outward' });
  const reconciled = outward.getByRole('row').filter({ hasText: 'Reconciliation' });
  await reconciled.getByRole('cell', { name: '1,300' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(reconciled.getByRole('button')).toHaveCount(0);
  await outward
    .getByRole('row')
    .filter({ hasText: 'Production assigned' })
    .getByRole('cell', { name: '200', exact: true })
    .click();
  await expect(dialog.getByLabel('Outward quantity')).toHaveValue('200');
});

test('view-only Inventory shows records and suppresses denied actions and links', async ({
  page,
}) => {
  const access = initialAccess();
  const { permissions } = access.roles.find(({ id }) => id === 'admin');
  permissions.materialStock = { view: true };
  permissions.materialIssues = { view: true };
  permissions.materialReceipts = { view: true };
  permissions.materials = { view: false };
  await page.addInitScript(
    (data) => localStorage.setItem('garments-access-preview-v1', JSON.stringify(data)),
    access,
  );
  await page.goto('/fabric.html#materialStock');
  const stock = page.getByRole('table', { name: 'Stock available' });
  await expect(stock.getByRole('cell', { name: 'Navy button 18L' })).toBeVisible();
  await expect(stock.getByRole('link', { name: 'Navy button 18L' })).toHaveCount(0);
  await expect(stock.getByRole('columnheader', { name: /Actions/ })).toHaveCount(0);
  await page.goto('/fabric.html#materialReceipts');
  const receipts = page.getByRole('table', { name: 'Stock receipts' });
  await receipts.getByRole('cell', { name: 'TRIM-001' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Receive stock' })).toHaveCount(0);
});

test('materials restore filters, groups and columns independently of Sheet', async ({ page }) => {
  await page.goto('/fabric.html#materials');
  const table = page.getByRole('table', { name: 'Materials', exact: true });
  await table.getByRole('button', { name: 'Material', exact: true }).click();
  await expect(table.getByRole('columnheader', { name: 'Material', exact: true })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('button', { name: '+ Add filter rule' }).click();
  await page.getByLabel('Filter field 1').selectOption('description');
  await page.getByLabel('Filter value 1').fill('Four-hole');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  await page.getByRole('button', { name: '+ Add grouping level' }).click();
  await page.getByLabel('Group field 1').selectOption('category');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Description', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(table.getByRole('columnheader', { name: /Description/ })).toBeVisible();
  await expect(table.getByRole('button', { name: /Trims · 1/ })).toBeVisible();
  await expect(table.getByRole('button', { name: 'Care label', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sheet', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Sheet zoom' })).toBeVisible();
  await page.locator('.fabric-view-toggle').getByRole('button', { name: 'Overview' }).click();
  await expect(table.getByRole('button', { name: /Trims · 1/ })).toBeVisible();
});
