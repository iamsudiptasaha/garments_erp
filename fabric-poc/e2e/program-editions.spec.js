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
        entry: fileURLToPath(new URL('./fixtures/program-editor.js', import.meta.url)),
        formats: ['es'],
        name: 'ProgramAcceptance',
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  outputs = Array.isArray(result) ? result.flatMap((r) => r.output) : result.output;
});
async function open(page) {
  await page.route('**/__program-acceptance**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('.js'))
      return route.fulfill({
        contentType: 'text/javascript',
        body: outputs.find((x) => x.type === 'chunk').code,
      });
    if (path.endsWith('.css'))
      return route.fulfill({
        contentType: 'text/css',
        body: outputs
          .filter((x) => x.fileName.endsWith('.css'))
          .map((x) => x.source)
          .join('\n'),
      });
    return route.fulfill({
      contentType: 'text/html',
      body: '<html lang="en"><head><link rel="stylesheet" href="/__program-acceptance.css"></head><body><div id="root"></div><script type="module" src="/__program-acceptance.js"></script></body></html>',
    });
  });
  await page.goto('/__program-acceptance');
  await expect(page.getByRole('dialog', { name: 'Dyeing Program', exact: true })).toBeVisible();
}
async function choose(page, name, query, text) {
  const input = page.getByRole('combobox', { name, exact: true });
  await input.fill(query);
  await page.getByRole('option').filter({ hasText: text }).first().click();
}
test('complete planner links reopen checked, consolidate editions, recalculate and preserve manual overrides', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.getByRole('button', { name: 'Manage Rows', exact: true }).click();
  await page.getByRole('button', { name: 'Manage Links', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Fabric Planner · Add to Program', exact: true });
  await expect(picker.getByRole('checkbox', { name: /Body/ })).toBeChecked();
  await picker.getByRole('checkbox', { name: /Sleeve/ }).check();
  await picker.getByRole('button', { name: 'Review complete links', exact: true }).click();
  const review = page.getByRole('dialog', {
    name: 'Reconfirm Complete Planner Links',
    exact: true,
  });
  await expect(
    review.getByRole('heading', { name: 'Reconfirm Complete Planner Links', exact: true }),
  ).toBeInViewport();
  await expect(review.getByRole('heading', { name: 'Navy · Edition 1', exact: true })).toHaveCount(
    1,
  );
  await expect(review).toContainText('Existing');
  await expect(review).toContainText('Added');
  await expect(review).toContainText('99 → 16');
  await page.screenshot({ path: test.info().outputPath('complete-links.png') });
  await review.getByRole('button', { name: 'Confirm complete links', exact: true }).click();
  await page.getByRole('button', { name: 'Manage Rows', exact: true }).click();
  const rows = page.getByRole('dialog', { name: 'Manage Program Rows', exact: true });
  await expect(
    rows.getByRole('spinbutton', { name: 'Sinker ordered kg', exact: true }),
  ).toHaveValue('16');
  await rows.getByRole('spinbutton', { name: 'Sinker ordered kg', exact: true }).fill('21');
  await rows.getByRole('button', { name: 'Manage Links', exact: true }).click();
  await expect(picker.getByRole('checkbox', { name: /Body/ })).toBeChecked();
  await expect(picker.getByRole('checkbox', { name: /Sleeve/ })).toBeChecked();
  await picker.getByRole('checkbox', { name: /Body/ }).uncheck();
  await picker.getByRole('button', { name: 'Review complete links', exact: true }).click();
  await expect(review).toContainText('Removed');
  await review.getByRole('button', { name: 'Confirm complete links', exact: true }).click();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Review Dyeing Program' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Confirm save', exact: true }).click();
  const saved = await page.evaluate(() => window.programSaves[0]);
  expect(saved.dyeing_program_item.find((i) => i.id === 'item-fixture').quantity).toBe(21);
  expect(saved.fabric_plan_dyeing_link).toEqual([
    { item_part_fabric_id: 'requirement-sleeve', dyeing_program_item_id: 'item-fixture' },
  ]);
  expect(errors).toEqual([]);
});
test('searchable colour and explicit edition/version separate the same colour; sheet totals and preferences remain independent', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Add from Fabric Planner', exact: true }).click();
  await choose(page, 'Colour', 'Nav', 'Navy');
  await choose(page, 'Lab Dip edition', '2', 'Edition 2');
  await expect(page.getByRole('combobox', { name: 'Explicit version', exact: true })).toBeEmpty();
  await choose(page, 'Explicit version', 'Version 1', 'Status not recorded');
  const picker = page.getByRole('dialog', { name: 'Fabric Planner · Add to Program', exact: true });
  await expect(picker.getByRole('checkbox')).toHaveCount(1);
  await picker.getByRole('checkbox').check();
  await picker.getByRole('button', { name: 'Add to Program', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Reconfirm Complete Planner Links', exact: true })
    .getByRole('button', { name: 'Confirm complete links', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Navy · Edition 1', exact: true })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Navy · Edition 2', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Source', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Sheet View', exact: true }).click();
  await expect(page.locator('.fortune-sheet-canvas').first()).toBeVisible();
  await page.locator('.erp-grid-columns summary').click();
  await expect(
    page.getByRole('combobox', { name: 'Column to configure' }).locator('option'),
  ).toContainText(['Source']);
  await page.locator('.erp-grid-columns summary').click();
  await page.screenshot({ path: test.info().outputPath('edition-sheet.png') });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: /Source/ })).toHaveCount(0);
  await expect(page.locator('.planner-total').last()).toContainText('102');
});
test('six editions share group-level batches and no version is automatically selected for manual rows', async ({
  page,
}) => {
  await open(page);
  await choose(page, 'Navy · Edition 1 version', 'Version 2', 'Version 2');
  await choose(page, 'Navy · Edition 1 Batch No.', 'B-104', 'B-104');
  await expect(
    page.getByRole('combobox', { name: 'Navy · Edition 1 Batch No.', exact: true }),
  ).toHaveCount(1);
  for (let edition = 2; edition <= 6; edition++) {
    await page.getByRole('button', { name: 'Add manual row', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add manual fabric requirement' });
    await choose(page, 'Lab Dip edition', String(edition), 'Edition ' + edition);
    await expect(
      dialog.getByRole('combobox', { name: 'Explicit version', exact: true }),
    ).toBeEmpty();
    await choose(page, 'Explicit version', 'Version 1', 'Version 1');
    await choose(page, 'Fabric type', 'Sinker', 'Sinker');
    await dialog.getByRole('spinbutton', { name: 'Ordered kg', exact: true }).fill('3.5');
    await dialog.getByRole('button', { name: 'Add manual row', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: /Navy · Edition [1-6]$/, level: 3 })).toHaveCount(
    6,
  );
  await page.getByRole('button', { name: 'Add manual row', exact: true }).click();
  const manual = page.getByRole('dialog', { name: 'Add manual fabric requirement' });
  await choose(page, 'Lab Dip edition', '7', 'Edition 7');
  await choose(page, 'Explicit version', 'Version 1', 'Version 1');
  await manual.getByRole('button', { name: 'Add manual row', exact: true }).click();
  await manual.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('six edition groups');
  await page.screenshot({ path: test.info().outputPath('six-editions.png') });
});
test('only the ordered-kg cell edits the staged document; summaries and identities stay protected', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'program-fixture:dyeing-program-editor-sheet',
      JSON.stringify({
        columnWidths: { colour: 140, lab: 200, 'fabric-ft1': 120, source: 100, batch: 100 },
      }),
    ),
  );
  await open(page);
  await page.getByRole('button', { name: 'Sheet View', exact: true }).click();
  const overlay = page.locator('.fortune-sheet-overlay');
  await expect(overlay).toBeVisible();
  await overlay.dblclick({ position: { x: 440, y: 82 } });
  const input = page.locator('#luckysheet-rich-text-editor');
  await expect(input).toBeVisible();
  await input.fill('25');
  await input.press('Enter');
  await page.getByRole('button', { name: 'Manage Rows', exact: true }).click();
  const rows = page.getByRole('dialog', { name: 'Manage Program Rows' });
  await expect(
    rows.getByRole('spinbutton', { name: 'Sinker ordered kg', exact: true }),
  ).toHaveValue('25');
  await rows.getByRole('button', { name: 'Close', exact: true }).click();
  await overlay.click({ position: { x: 85, y: 82 } });
  await page.keyboard.type('FORGED');
  await expect(page.locator('.form-error[role=alert]')).toContainText('protected');
  expect(await page.evaluate(() => window.programSaves.length)).toBe(0);
});
test('Finalization reviews the proposed Final status and writes only after confirmation', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Review finalization', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Review Dyeing Program' })).toContainText(
    'Draft → Final',
  );
  expect(await page.evaluate(() => window.programSaves.length)).toBe(0);
  await page.getByRole('button', { name: 'Back to edit', exact: true }).click();
  await expect(page.getByText('Status: Draft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review finalization', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm save', exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        window.programSaves[0].dyeing_program.find((p) => p.id === 'program-fixture')
          .dyeing_program_status_id,
    ),
  ).toBe('2');
});

test('removed groups retain edition, version, batch and linked-row context in confirmation', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Manage Rows', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Row', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Manage Program Rows', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: 'Remove empty group', exact: true }).click();
  // Keep another valid Draft group so the removed group's old identity must be reviewed.
  await page.getByRole('button', { name: 'Add manual row', exact: true }).click();
  const manual = page.getByRole('dialog', { name: 'Add manual fabric requirement' });
  await choose(page, 'Lab Dip edition', '2', 'Edition 2');
  await choose(page, 'Explicit version', 'Version 1', 'Version 1');
  await choose(page, 'Fabric type', 'Sinker', 'Sinker');
  await manual.getByRole('spinbutton', { name: 'Ordered kg', exact: true }).fill('3');
  await manual.getByRole('button', { name: 'Add manual row', exact: true }).click();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  const review = page.getByRole('region', { name: 'Review Dyeing Program' });
  await expect(review.getByRole('heading', { name: 'Navy · Edition 1', exact: true })).toHaveCount(
    1,
  );
  await expect(review).toContainText('Removed');
  await expect(review).toContainText('99 → Removed');
  await expect(review).toContainText('Version 1');
  expect(await page.evaluate(() => window.programSaves.length)).toBe(0);
});
test('empty group can be saved as Draft but blocks explicit Finalization', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Manage Rows', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Row', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Manage Program Rows', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: 'Review finalization', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Final programs require');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm save', exact: true }).click();
  expect(
    await page.evaluate(() =>
      window.programSaves[0].dyeing_program_lab_dip.some((g) => g.id === 'group-fixture'),
    ),
  ).toBe(true);
});

test('reuse label requires an explicit persisted source rather than another program sharing the edition', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByText('Approved from Previous Program', { exact: true })).toHaveCount(0);
  const source = page.getByRole('combobox', {
    name: 'Navy · Edition 1 Source Program',
    exact: true,
  });
  await source.click();
  await page.getByRole('option').first().click();
  await expect(page.getByText('Approved from Previous Program', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm save', exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        window.programSaves[0].dyeing_program_lab_dip.find((g) => g.id === 'group-fixture')
          .source_dyeing_program_id,
    ),
  ).toBe('dp1');
});
