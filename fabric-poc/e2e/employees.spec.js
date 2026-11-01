import { test, expect } from '@playwright/test';
test('employee details, references and review use the same protected form', async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Never edit production records in browser tests');
  await page.goto('/fabric.html#employees');
  await page.getByRole('button', { name: '+ Add employee', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Bank details', exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Account number', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Date of joining', { exact: true }).fill('2026-10-01');
  await dialog.getByRole('button', { name: 'Contact links', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Employee contact', exact: true }).click();
  const option = dialog.getByRole('option').first();
  const name = await option.textContent();
  await option.click();
  await expect(dialog.getByLabel('Employee name', { exact: true })).toHaveCount(0);
  await dialog.getByRole('combobox', { name: 'Emergency contact', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Emergency contact', exact: true }).press('ArrowDown');
  await dialog.getByRole('combobox', { name: 'Emergency contact', exact: true }).press('Enter');
  const emergencyName = await dialog.locator('.employee-select__single-value').last().textContent();
  await dialog.getByRole('button', { name: 'Review employee', exact: true }).click();
  await expect(
    dialog
      .locator('.hr-review dl > div')
      .filter({ has: page.locator('dt', { hasText: 'Employee contact' }) })
      .getByText(name, { exact: true }),
  ).toBeVisible();
  await expect(
    dialog
      .locator('.hr-review dl > div')
      .filter({ has: page.locator('dt', { hasText: 'Emergency contact' }) })
      .getByText(emergencyName, { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm & save employee', exact: true }).click();
  await expect(page.getByRole('button').filter({ hasText: name })).toBeVisible();
  await page.getByRole('button', { name: 'Employment types', exact: true }).click();
  await expect(page).toHaveURL(/#employeeEmploymentTypes$/);
  await expect(page.locator('.hr-workspace > .fabric-view-toggle')).toHaveCount(0);
  await page.getByLabel('New value', { exact: true }).fill('Synthetic employment type');
  await page.getByRole('button', { name: 'Add value', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'Synthetic employment type', exact: true }),
  ).toBeVisible();
});
test('cross-page sidebar links match navigation button typography', async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Local preview navigation only');
  await page.goto('/fabric.html#brands');
  const link = page.getByRole('link', { name: 'Bucket groups', exact: true });
  const style = await link.evaluate((el) => {
    const s = getComputedStyle(el);
    return { font: s.fontSize, decoration: s.textDecorationLine, color: s.color };
  });
  const button = await page
    .getByRole('button', { name: 'Roles & permissions', exact: true })
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { font: s.fontSize, color: s.color };
    });
  expect(style.decoration).toBe('none');
  expect(style.font).toBe(button.font);
  expect(style.color).toBe(button.color);
});
test('bank details and supporting document stay in the contact-owned screen', async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Local preview only');
  await page.goto('/fabric.html#contactBankAccounts');
  await page.getByRole('button', { name: '+ Add bank account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Company / contact', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Account number', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Supporting document', { exact: true })).toBeVisible();
});
