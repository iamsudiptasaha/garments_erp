import { expect, test } from '@playwright/test';

const pages = [
  ['productionStageTypes', 'Stage types'],
  ['productionPartTypes', 'Part names'],
  ['productionSizes', 'Sizes'],
  ['productionProductTypes', 'Product types'],
  ['productionDesigns', 'Variants'],
  ['productionFlags', 'Flags'],
  ['productionGenders', 'Gender'],
  ['brands', 'Brands'],
  ['productionStages', 'Stages'],
  ['productionWorkers', 'Job workers'],
  ['productionItems', 'Items'],
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
    if (route === 'productionWorkers') {
      await expect(editor.getByLabel('Company / contact').locator('option:checked')).toHaveText(
        name,
      );
    } else {
      await expect(editor.locator('input').first()).toHaveValue(name);
    }
    await editor
      .getByRole('button', { name: /cancel|close/i })
      .first()
      .click();
    const search = page.getByRole('searchbox', { name: 'Search ' + title, exact: true });
    await search.fill('missing-production-record-999');
    await expect(table.getByText('No matching records')).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(identity).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Columns', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.getByRole('button', { name: 'Sheet', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Sheet zoom' })).toBeVisible();
  });
}

test('Production foreign-key links navigate without opening the row editor', async ({ page }) => {
  await page.goto('/fabric.html#productionStages');
  const table = page.getByRole('table', { name: 'Stages', exact: true });
  const link = table.getByRole('link').first();
  await expect(link).toHaveAttribute('href', '/fabric.html#productionStageTypes');
  await link.click();
  await expect(page.getByRole('table', { name: 'Stage types', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
