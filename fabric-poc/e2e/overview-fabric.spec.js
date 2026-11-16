import { expect, test } from '@playwright/test';

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
