import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
let outputs;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: fileURLToPath(new URL('./fixtures/planner-workspace.js', import.meta.url)),
        formats: ['es'],
        name: 'PlannerAcceptance',
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  outputs = Array.isArray(result) ? result.flatMap((r) => r.output) : result.output;
});
async function open(page, account = 'operator') {
  await page.route('**/__planner-acceptance**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('.js'))
      return route.fulfill({
        contentType: 'text/javascript',
        body: outputs.find((x) => x.type === 'chunk').code,
      });
    if (url.pathname.endsWith('.css'))
      return route.fulfill({
        contentType: 'text/css',
        body: outputs
          .filter((x) => x.fileName.endsWith('.css'))
          .map((x) => x.source)
          .join('\n'),
      });
    return route.fulfill({
      contentType: 'text/html',
      body: '<html><head><link rel="stylesheet" href="/__planner-acceptance.css"></head><body><div id="root"></div><script type="module" src="/__planner-acceptance.js"></script></body></html>',
    });
  });
  await page.goto('/__planner-acceptance?account=' + account);
  await expect(page.locator('[data-requirement]')).toHaveCount(4);
}
test('approved Planner uses shared controls, identities, totals and independent views', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  const grand = page.getByTestId('grand');
  await expect(grand).toContainText('19.25');
  await expect(grand).toContainText('5.5');
  await expect(page.getByTestId('subtotal:Red')).toContainText('19.25');
  await expect(page.getByRole('columnheader', { name: /Production Part/ })).toBeVisible();
  await page.locator('[data-requirement="2"]').getByRole('button').click();
  const source = page.getByRole('dialog', { name: 'Fabric requirement source' });
  await expect(source).toContainText('101');
  await expect(source).toContainText('Sleeve');
  await expect(source.getByRole('button', { name: 'Edit fabric requirement' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page
    .getByRole('columnheader', { name: /^Colour/ })
    .getByRole('button')
    .click();
  await page
    .getByRole('columnheader', { name: /^Colour/ })
    .getByRole('button')
    .click();
  await expect(page.locator('.planner-group').first()).toContainText('Red');
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Customize columns' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Variant', exact: true }).uncheck();
  await page.getByRole('spinbutton', { name: 'Style Code width in pixels' }).fill('310');
  await page.getByRole('spinbutton', { name: 'Style Code width in pixels' }).blur();
  await page.getByRole('button', { name: 'Move Lab Dip left' }).click();
  await page.screenshot({ path: test.info().outputPath('planner-columns.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: /^Variant/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sheet View', exact: true }).click();
  await expect(page.locator('.fortune-sheet-canvas').first()).toBeVisible();
  await page.locator('.erp-grid-columns summary').click();
  await page.getByRole('combobox', { name: 'Column to configure' }).selectOption('variant');
  await expect(page.getByRole('button', { name: 'Hide column', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide column', exact: true }).click();
  await page.locator('.erp-grid-columns summary').click();
  await page.getByRole('searchbox', { name: 'Search fabric requirements' }).fill('Red');
  await expect(page.getByRole('combobox', { name: 'Sort column' }).locator('option')).toHaveCount(
    7,
  );
  await expect(
    page.getByRole('combobox', { name: 'Sort column' }).locator('option'),
  ).not.toContainText(['Dynamic rib']);
  await page.getByRole('combobox', { name: 'Sort direction' }).selectOption('desc');
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toHaveCount(0);
  await expect(page.locator('.fabric-grid ~ .lab-record-table-wrap')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('planner-sheet.png') });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.locator('[data-requirement]')).toHaveCount(3);
  await expect(grand).toContainText('19.25');
  await expect(page.getByRole('columnheader', { name: /Dynamic rib/ })).toHaveCount(0);
  await page.getByRole('searchbox').fill('');
  await expect(page.locator('[data-requirement]')).toHaveCount(4);
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('button', { name: '+ Add filter rule' }).click();
  await page.getByRole('combobox', { name: 'Filter field 1' }).selectOption('lab');
  await page.getByRole('combobox', { name: 'Filter operator 1' }).selectOption('is');
  await page.getByRole('textbox', { name: 'Filter value 1' }).fill('Blue · Edition 2 · 42');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-requirement]')).toHaveCount(1);
  await expect(grand).toContainText('5.5');
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(page.locator('[data-requirement]')).toHaveCount(4);
  await page.reload();
  await expect(page.getByRole('columnheader', { name: /^Variant/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Style Code width in pixels' })).toHaveValue(
    '310',
  );
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.refreshPlannerFixture());
  await expect(grand).toContainText('20.25');
  await page.getByRole('button', { name: 'Sheet View', exact: true }).click();
  await page.locator('.erp-grid-columns summary').click();
  await page.getByRole('combobox', { name: 'Column to configure' }).selectOption('variant');
  await expect(page.getByRole('button', { name: 'Show column', exact: true })).toBeVisible();
  await page.locator('.erp-grid-columns summary').click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: test.info().outputPath('planner-overview.png') });
  await open(page, 'other-account');
  await expect(page.getByRole('columnheader', { name: /^Variant/ })).toBeVisible();
  expect(errors).toEqual([]);
});

// Removing grouping must restore the shared table's global row sort, not just hide headings.
test('Overview ungrouping restores global sorting without changing Sheet grouping', async ({
  page,
}) => {
  await open(page, 'ungrouped-operator');
  await page.getByRole('button', { name: /^Group/ }).click();
  await page.getByRole('button', { name: 'Remove group rule 1' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Sort/ }).click();
  await page.getByRole('combobox', { name: 'Sort field 1' }).selectOption('subpart');
  await page.getByRole('combobox', { name: 'Sort direction 1' }).selectOption('desc');
  await page.keyboard.press('Escape');
  await expect(page.locator('.planner-group')).toHaveCount(0);
  await expect(page.locator('[data-testid^="subtotal:"]')).toHaveCount(0);
  await expect(page.locator('[data-requirement]').first()).toHaveAttribute('data-requirement', '2');
  await expect(page.getByTestId('grand')).toContainText('19.25');
  await page.reload();
  await expect(page.locator('[data-requirement]').first()).toHaveAttribute('data-requirement', '2');
  await page.getByRole('button', { name: 'Sheet View', exact: true }).click();
  await expect(page.getByText('7 rows', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.planner-group')).toHaveCount(0);
  await page.getByRole('button', { name: /^Group/ }).click();
  await page.getByRole('button', { name: '+ Add grouping level' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.planner-group')).toHaveCount(2);
  await expect(page.getByTestId('subtotal:Red')).toContainText('19.25');
});
