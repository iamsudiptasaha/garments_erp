import { test, expect } from '@playwright/test';

for (const [width, shellPadding, dialogPadding] of [
  [1440, '34px 38px', '28px'],
  [1024, '25px', '28px'],
  [390, '20px 15px', '20px'],
]) {
  test(`Colours preserves the overview and dialog at ${width}px`, async ({ page }) => {
    test.skip(!!process.env.E2E_BASE_URL, 'Uses the local Colours fixtures');
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/fabric.html#labDips');

    const header = page.locator('.fabric-page-header');
    const grid = page.getByRole('table', { name: 'Lab dips', exact: true });
    const edition = grid.getByRole('button', { name: 'Sage', exact: true }).first();
    await expect(page.locator('.fabric-main')).toHaveCSS('padding', shellPadding);
    await expect(header).toHaveCSS('gap', '10px');
    await expect(header.getByRole('heading', { name: 'Lab dips' })).toHaveCSS('font-size', '29px');
    const scrollRegion = page.getByRole('region', { name: 'Lab dips', exact: true });
    await expect(scrollRegion).toHaveAttribute('tabindex', '0');
    await expect(grid.getByRole('columnheader')).toHaveCount(5);
    await expect(header.getByRole('button', { name: '+ Create edition' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const screenshot = { animations: 'disabled', caret: 'hide' };
    const overview = await scrollRegion.screenshot(screenshot);
    await page.screenshot({
      ...screenshot,
      path: test.info().outputPath(`colours-reference-${width}.png`),
    });

    await edition.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('padding', dialogPadding);
    await expect(dialog).toHaveCSS('border-radius', '15px');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    const toggle = header.locator('.fabric-view-toggle');
    await expect(toggle).toHaveCSS('background-color', 'rgb(231, 239, 247)');
    await expect(toggle).toHaveCSS('border-radius', '9px');
    await expect(toggle).toHaveCSS('padding', '4px');
    await toggle.getByRole('button', { name: 'Sheet' }).click();
    await expect(header).toHaveCSS('gap', '20px');
    await expect(page.getByRole('combobox', { name: 'Sheet zoom' })).toBeVisible();
    await toggle.getByRole('button', { name: 'Overview' }).click();
    await page.mouse.move(0, 0);
    await scrollRegion.evaluate((region) => {
      region.scrollLeft = 0;
    });
    await expect
      .poll(async () => (await scrollRegion.screenshot(screenshot)).equals(overview))
      .toBe(true);
  });
}
