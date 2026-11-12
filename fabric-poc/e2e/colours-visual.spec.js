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
    const grid = page.locator('.overview-grid');
    const card = grid.locator('.lab-card').first();
    await expect(page.locator('.fabric-main')).toHaveCSS('padding', shellPadding);
    await expect(header).toHaveCSS('gap', '20px');
    await expect(header.getByRole('heading', { name: 'Lab dips' })).toHaveCSS('font-size', '29px');
    await expect(grid).toHaveCSS('gap', '18px');
    await expect(card).toHaveCSS('background-color', 'rgb(227, 240, 251)');
    await expect(card).toHaveCSS('border-radius', '15px');
    await expect(card.getByRole('button')).toHaveCSS('padding', '25px');
    await page.evaluate(() => document.fonts.ready);
    const screenshot = { animations: 'disabled', caret: 'hide' };
    const overview = await grid.screenshot(screenshot);
    await page.screenshot({
      ...screenshot,
      path: test.info().outputPath(`colours-reference-${width}.png`),
    });

    await card.getByRole('button').click();
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
    await expect(page.getByRole('combobox', { name: 'Sheet zoom' })).toBeVisible();
    await toggle.getByRole('button', { name: 'Overview' }).click();
    await page.mouse.move(0, 0);
    expect(await grid.screenshot(screenshot)).toEqual(overview);
  });
}
