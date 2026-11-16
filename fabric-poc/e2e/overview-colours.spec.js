import { expect, test } from '@playwright/test';
import { initialAccess } from '../src/admin/model.js';

test.skip(!!process.env.E2E_BASE_URL, 'Uses local Colours records and roles');

test('Colour library opens the record after sorting and searching', async ({ page }) => {
  await page.goto('/fabric.html#colours');
  const table = page.getByRole('table', { name: 'Colour library', exact: true });
  await table.getByRole('button', { name: /Colour name/ }).click();
  await expect(table.getByRole('columnheader', { name: /Colour name/ })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await page.getByRole('searchbox', { name: 'Search Colour library' }).fill('Sage');
  await expect(table.getByRole('button', { name: 'Navy', exact: true })).toHaveCount(0);
  await table.getByRole('row').filter({ hasText: 'Sage' }).getByRole('cell').last().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Colour name')).toHaveValue('Sage');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search Colour library' })).toHaveValue('Sage');
  await expect(table.getByRole('button', { name: 'Navy', exact: true })).toHaveCount(0);
});

test('Colour mappings distinguish related links from the mapping editor', async ({ page }) => {
  await page.goto('/fabric.html#colourMappings');
  const table = page.getByRole('table', { name: 'Colour mappings', exact: true });
  const mapping = table.getByRole('row').filter({ hasText: 'Sage' });
  await mapping.getByRole('button', { name: 'Sage', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Colour', { exact: true })).toHaveValue('cm2');
  await page.keyboard.press('Escape');
  await mapping.getByRole('link', { name: 'Core', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Brands', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Read-only Lab dips opens progress and saves optional column preferences', async ({
  page,
}) => {
  const access = initialAccess();
  const { permissions } = access.roles.find(({ id }) => id === 'admin');
  permissions.labDips = { view: true };
  permissions.brands = { view: false };
  await page.addInitScript(
    (data) => localStorage.setItem('garments-access-preview-v1', JSON.stringify(data)),
    access,
  );
  await page.goto('/fabric.html#labDips');
  const table = page.getByRole('table', { name: 'Lab dips', exact: true });
  await expect(page.getByRole('button', { name: '+ Create edition' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Dyer', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Brand', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(table.getByRole('columnheader', { name: /Brand/ })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: /Dyer/ })).toHaveCount(0);
  const edition = table.getByRole('row').filter({ hasText: 'Sage' }).first();
  await expect(edition.getByRole('cell', { name: 'Core', exact: true })).toBeVisible();
  await expect(edition.getByRole('link', { name: 'Core', exact: true })).toHaveCount(0);
  await edition.getByRole('button', { name: 'Sage', exact: true }).click();
  const progress = page.getByRole('dialog');
  await expect(progress.getByRole('heading', { name: /Sage · Edition/ })).toBeVisible();
  await expect(progress.getByRole('heading', { name: 'Status history' })).toBeVisible();
  await expect(
    progress.getByRole('button', { name: /Update version|Add version|New edition/ }),
  ).toHaveCount(0);
});
