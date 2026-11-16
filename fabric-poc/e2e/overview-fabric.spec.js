import { expect, test } from '@playwright/test';
import { initialAccess } from '../src/admin/model.js';

test('Yarn types keeps its record editor and Sheet while saving Overview preferences', async ({
  page,
}) => {
  await page.goto('/fabric.html#yarnTypes');
  const table = page.getByRole('table', { name: 'Yarn types', exact: true });
  const name = '30S Shivam CCH';
  const identity = table.getByRole('button', { name, exact: true });
  await identity.press('Enter');
  const editor = page.getByRole('dialog');
  await expect(editor.getByLabel('Yarn type name')).toHaveValue(name);
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();

  await table.getByRole('button', { name: /Yarn count/ }).click();
  await expect(table.getByRole('columnheader', { name: /Yarn count/ })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await table.getByRole('button', { name: /Yarn count/ }).click();
  await expect(table.getByRole('columnheader', { name: /Yarn count/ })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('button', { name: '+ Add filter rule' }).click();
  await page.getByLabel('Filter field 1').selectOption('count');
  await page.getByLabel('Filter value 1').fill('30S');
  await page.keyboard.press('Escape');
  await expect(table.getByRole('row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Purchase order lines' }).uncheck();
  await page.getByLabel('Yarn count width in pixels').fill('220');
  await page.getByLabel('Yarn count width in pixels').press('Tab');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('columnheader', { name: /Purchase order lines/ })).toHaveCount(0);
  await expect(table.locator('col').nth(1)).toHaveCSS('width', '220px');

  await page.getByRole('button', { name: 'Sheet', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Sheet zoom' })).toBeVisible();
  await page.locator('.fabric-view-toggle').getByRole('button', { name: 'Overview' }).click();
  await expect(identity).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add yarn type' })).toBeVisible();
});

for (const [route, title, field] of [
  ['fabricTypes', 'Fabric types', 'Fabric type name'],
  ['suppliers', 'Suppliers', 'Company / contact'],
]) {
  test(title + ' opens its existing record from Overview and retains Sheet', async ({ page }) => {
    await page.goto('/fabric.html#' + route);
    const table = page.getByRole('table', { name: title, exact: true });
    const identity = table.locator('tbody button').first();
    const name = await identity.innerText();
    await identity.click();
    const editor = page.getByRole('dialog');
    const input = editor.getByLabel(field);
    if (route === 'suppliers') {
      await expect(input.locator('option:checked')).toHaveText(name);
    } else {
      await expect(input).toHaveValue(name);
    }
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Sheet', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Sheet zoom' })).toBeVisible();
  });
}

for (const [route, title, identity, field, lineText] of [
  ['orders', 'Yarn purchase orders', 'YPO-014', 'Purchase order number', '30S Shivam CCH'],
  ['yarn', 'Yarn bills', 'YB-014', 'Invoice number', '30S Shivam CCH'],
  ['knitting', 'Knitting bills', 'KB-026', 'Invoice number', 'Sinker'],
  ['programs', 'Dyeing programs', 'DP-031', 'Program number', 'Soft finish'],
  ['dyeBills', 'Dyed fabric bills', 'DF-031', 'Invoice number', 'Sinker'],
]) {
  test(
    title + ' keeps document identity, searchable lines and the existing editor',
    async ({ page }) => {
      await page.goto('/fabric.html#' + route);
      const table = page.getByRole('table', { name: title, exact: true });
      const row = table.getByRole('row').filter({
        has: page.getByRole('button', { name: identity, exact: true }),
      });
      await expect(row).toHaveCount(1);
      await expect(page.getByRole('region', { name: title, exact: true })).toHaveAttribute(
        'tabindex',
        '0',
      );
      const search = page.getByRole('searchbox', { name: 'Search ' + title, exact: true });
      await search.fill('no-matching-fabric-document');
      await expect(table.getByText('No matching records')).toBeVisible();
      await search.fill(lineText);
      await expect(row).toBeVisible();
      const details = row.locator('details');
      await details.locator('summary').click();
      await expect(details).toHaveAttribute('open', '');
      await expect(details.getByText('Total', { exact: true })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await row
        .getByRole('cell')
        .first()
        .click({ position: { x: 2, y: 2 } });
      const editor = page.getByRole('dialog');
      const documentNumber = editor.getByLabel(field, { exact: true });
      if (route === 'orders' || route === 'programs') {
        await expect(documentNumber).toHaveText(identity);
      } else {
        await expect(documentNumber).toHaveValue(identity);
      }
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Sheet', exact: true }).click();
      await expect(page.getByRole('combobox', { name: 'Sheet zoom' })).toBeVisible();
    },
  );
}

test('Fabric document links navigate without opening the editor', async ({ page }) => {
  await page.goto('/fabric.html#yarn');
  const table = page.getByRole('table', { name: 'Yarn bills', exact: true });
  await table.getByRole('link', { name: 'YPO-014', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Yarn purchase orders', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const [route, title, search, value, disclosure, source] of [
  ['dyed', 'Dyed fabrics', 'B-104', '298.48'],
  ['yarnLeft', 'Yarn left', 'YB-014', '380', 'See consumption by bill', 'KB-026'],
  ['greige', 'Greige left', 'KB-026', '85', 'See consumption by bill', 'DF-031'],
  ['batches', 'Batch traceability', 'B-104', '288', 'See batch journey', 'DP-031'],
]) {
  test(
    title + ' displays existing report data and remains read-only on mobile',
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/fabric.html#' + route);
      const table = page.getByRole('table', { name: title, exact: true });
      await page.getByRole('searchbox', { name: 'Search ' + title, exact: true }).fill(search);
      const row = table.getByRole('row').filter({
        has: page.getByRole('cell', { name: value, exact: true }),
      });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole('cell').first()).toBeVisible();
      await row
        .getByRole('cell')
        .first()
        .click({ position: { x: 2, y: 2 } });
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Add|New document/ })).toHaveCount(0);
      if (disclosure) {
        const details = row.locator('details');
        await details.getByText(disclosure, { exact: true }).click();
        await expect(
          details.getByText(source, { exact: route === 'batches' }).first(),
        ).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      await page.getByRole('button', { name: 'Sheet', exact: true }).click();
      await expect(page.getByRole('combobox', { name: 'Sheet zoom' })).toBeVisible();
    },
  );
}

test('Fabric Overview preserves distinct edit, create and related page permissions', async ({
  page,
}) => {
  await page.goto('/fabric.html#yarn');
  const access = initialAccess();
  const { permissions } = access.roles.find(({ id }) => id === 'admin');
  permissions.orders = { view: false };
  for (const view of [true, false]) {
    permissions.yarn = { view };
    await page.evaluate(
      (data) => localStorage.setItem('garments-access-preview-v1', JSON.stringify(data)),
      access,
    );
    await page.reload();
    await expect(page.getByRole('button', { name: '+ New document', exact: true })).toHaveCount(0);
    const table = page.getByRole('table', { name: 'Yarn bills', exact: true });
    if (view) {
      await table.getByRole('cell', { name: 'YB-014', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(table.getByRole('cell', { name: 'YPO-014', exact: true })).toBeVisible();
      await expect(table.getByRole('link', { name: 'YPO-014', exact: true })).toHaveCount(0);
    } else {
      await expect(table).toHaveCount(0);
    }
  }
});
