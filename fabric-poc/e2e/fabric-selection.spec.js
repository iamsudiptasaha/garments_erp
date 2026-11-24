import { test, expect } from '@playwright/test';
test('Lab Dip record search shows exact edition/version and latest review fields', async ({
  page,
}) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Local sample-only interaction');
  await page.goto('/fabric.html#programs');
  await page.locator('.erp-overview-table tbody tr').first().getByRole('button').first().click();
  const picker = page
    .getByRole('combobox', { name: 'Navy · Edition 1 version', exact: true })
    .first();
  await picker.fill('Navy');
  const option = page.getByRole('listbox').getByRole('option').filter({ hasText: 'Navy' });
  await expect(option.first()).toContainText('Edition 1');
  await expect(option.first()).toContainText('Version 1');
  await expect(option.first()).toContainText('Status not recorded');
  await option.first().click();
  await expect(picker).toBeVisible();
});
test('dyed bills show detailed searchable program records and require verification on every save', async ({
  page,
}) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Local sample-only save');
  await page.goto('/fabric.html#dyeBills');
  await page.locator('.erp-overview-table tbody tr').first().getByRole('button').first().click();
  const picker = page.getByRole('combobox', { name: 'Line 1 Dyeing program line', exact: true });
  await picker.fill('Navy');
  const option = page
    .getByRole('listbox')
    .getByRole('option')
    .filter({ hasText: 'Sinker' })
    .first();
  await expect(option).toContainText('River Dyeing');
  await expect(option).toContainText('Edition 1');
  await expect(option).toContainText('Batch No.');
  await option.click();
  await page.getByRole('button', { name: 'Review document →', exact: true }).click();
  const save = page.getByRole('button', { name: 'Confirm & save document', exact: true });
  await expect(save).toBeDisabled();
  await page.getByLabel('Verifying employee', { exact: true }).selectOption('owner');
  await expect(save).toBeDisabled();
  await page
    .getByLabel('Verification password', { exact: true })
    .fill('synthetic-preview-password');
  const password = page.getByLabel('Verification password', { exact: true });
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show verification password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('synthetic-preview-password');
  await page.getByRole('button', { name: 'Hide verification password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem('garments-fabric-workspace-v1')),
  ).not.toContain('synthetic-preview-password');
  await page.locator('.erp-overview-table tbody tr').first().getByRole('button').first().click();
  await page.getByRole('button', { name: 'Review document →', exact: true }).click();
  await expect(save).toBeDisabled();
  await expect(page.getByLabel('Verification password', { exact: true })).toHaveValue('');
});

test('colour comments preserve rich formatting across review, save and reopen', async ({
  page,
}) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Local sample-only save');
  await page.goto('/fabric.html#programs');
  const program = page.getByRole('table', { name: 'Dyeing programs', exact: true });
  const programName = await program.locator('tbody tr').first().getByRole('button').innerText();
  const openProgram = () => program.getByRole('button', { name: programName, exact: true }).click();
  await openProgram();
  await page.getByRole('button', { name: 'Manage Rows', exact: true }).click();
  const comment = page.getByRole('textbox', { name: 'Sinker comments', exact: true }).first();
  await comment.fill('Approved shade — handle carefully');
  await comment.press('ControlOrMeta+A');
  await page.getByRole('button', { name: 'Bold', exact: true }).first().click();
  await expect(comment.locator('b, strong')).toHaveText('Approved shade — handle carefully');
  await page
    .getByRole('dialog', { name: 'Manage Program Rows' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(
    page.getByRole('dialog').locator('.fabric-rich-content b, .fabric-rich-content strong').first(),
  ).toHaveText('Approved shade — handle carefully');
  await page.getByRole('button', { name: 'Confirm save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openProgram();
  await page.getByRole('button', { name: 'Manage Rows', exact: true }).click();
  await expect(comment.locator('b, strong')).toHaveText('Approved shade — handle carefully');
  // Untrusted pasted markup never becomes executable content or attributes.
  await comment.evaluate((element) => {
    const data = new DataTransfer();
    data.setData(
      'text/html',
      '<p onclick="alert(1)"><b>Safe note</b><img src=x onerror="alert(1)"><script>alert(1)</script></p>',
    );
    element.focus();
    document.getSelection().selectAllChildren(element);
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(comment.locator('img, script, [onclick], [onerror]')).toHaveCount(0);
  await expect(comment.locator('b')).toHaveText('Safe note');
});
