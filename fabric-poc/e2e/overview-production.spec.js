import { expect, test } from '@playwright/test';

const pages = [
  ['productionStages', 'Stages'],

  ['brands', 'Brands'],

  ['productionGenders', 'Gender'],

  ['productionFlags', 'Flags'],

  ['productionDesigns', 'Variants'],

  ['productionProductTypes', 'Product types'],

  ['productionSizes', 'Sizes'],

  ['productionStageTypes', 'Stage types'],
  ['productionPartTypes', 'Part names'],
];

for (const [route, title] of pages) {
  test(`${title} uses the Overview table and existing record workflow`, async ({ page }) => {
    await page.goto('/fabric.html#' + route);
    const table = page.getByRole('table', { name: title, exact: true });
    if (route === 'productionFlags') {
      await expect(table.getByText('No matching records')).toBeVisible();
      await page.getByRole('button', { name: '+ Add flag', exact: true }).click();
      await page.getByLabel('Flag name').fill('Fixture flag');
      await page.getByRole('button', { name: /Review/ }).click();
      await page.getByRole('button', { name: /Confirm.*save|Save flag|Save record/i }).click();
    }
    const identity = table.getByRole('row').nth(1).getByRole('button').first();
    await expect(identity).toBeVisible();
    const name = await identity.innerText();
    await identity.press('Enter');
    const editor = page.getByRole('dialog');
    await expect(editor).toBeVisible();
    await expect(editor.locator('input').first()).toHaveValue(name);
    await editor
      .getByRole('button', { name: /cancel|close/i })
      .first()
      .click();
    const search = page.getByRole('searchbox', { name: 'Search ' + title, exact: true });
    await search.fill('missing-production-record-999');
    await expect(table.getByText('No matching records')).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(identity).toBeVisible();
    await page.getByRole('button', { name: 'Sheet', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Sheet zoom' })).toBeVisible();
  });
}
