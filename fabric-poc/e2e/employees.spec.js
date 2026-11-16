import { test, expect } from '@playwright/test';
import { initialAccess } from '../src/admin/model.js';
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
  await expect(
    page.getByRole('table', { name: 'Employees' }).getByRole('row').filter({ hasText: name }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Employment types', exact: true }).click();
  await expect(page).toHaveURL(/#employeeEmploymentTypes$/);
  await expect(
    page.getByRole('button', { name: '+ Add employment type', exact: true }),
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

test('Employee Overview keeps the profile and linked Contacts actions separate', async ({
  page,
}) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Local preview only');
  await page.goto('/fabric.html#employees');
  const table = page.getByRole('table', { name: 'Employees' });
  const add = page.getByRole('button', { name: '+ Add employee', exact: true });
  const sheet = page.getByRole('button', { name: 'Sheet', exact: true });
  expect((await add.boundingBox()).y).toBeGreaterThan((await sheet.boundingBox()).y);
  const profile = table.getByRole('row').filter({ hasText: 'ADMIN-001' });
  await profile.getByRole('cell', { name: 'Active', exact: true }).click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByRole('heading', { name: 'Workspace owner' })).toBeVisible();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();

  const search = page.getByRole('searchbox', { name: 'Search Employees', exact: true });
  await search.fill('ADMIN-001');
  await expect(table.getByRole('row')).toHaveCount(2);
  await page.reload();
  await expect(search).toHaveValue('ADMIN-001');
  await expect(table.getByRole('row')).toHaveCount(2);
  await sheet.click();
  await expect(table).toHaveCount(0);
  await expect(
    page.getByRole('searchbox', { name: 'Search employees', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open selected employee' })).toBeDisabled();
  await page.getByRole('main').getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(search).toHaveValue('ADMIN-001');

  // Use an Employee linked to a seeded Contacts record.
  await add.click();
  await editor.getByRole('button', { name: 'Contact links', exact: true }).click();
  await editor.getByRole('combobox', { name: 'Employee contact', exact: true }).click();
  const option = editor.getByRole('option').first();
  const contact = await option.textContent();
  await option.click();
  await editor.getByRole('button', { name: 'Review employee', exact: true }).click();
  await editor.getByRole('button', { name: 'Confirm & save employee', exact: true }).click();
  await search.fill(contact);
  const link = table.getByRole('link', { name: contact, exact: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await link.click();
  await expect(page).toHaveURL(/#materialContacts$/);
  await expect(editor).toHaveCount(0);
  await page.goBack();
  await expect(table).toBeVisible();
});

test('Employee Overview preserves read-only and denied access', async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Local preview permissions only');
  await page.goto('/fabric.html#employees');
  const access = initialAccess();
  const permissions = access.roles.find(({ id }) => id === 'admin').permissions;
  permissions.employees = { view: true };
  permissions.materialContacts = { view: false };
  const setAccess = async () => {
    await page.evaluate(
      (data) => localStorage.setItem('garments-access-preview-v1', JSON.stringify(data)),
      access,
    );
    await page.reload();
  };
  await setAccess();
  const table = page.getByRole('table', { name: 'Employees' });
  await expect(page.getByRole('button', { name: '+ Add employee' })).toHaveCount(0);
  await expect(table.getByRole('link')).toHaveCount(0);
  await table.getByRole('button', { name: 'ADMIN-001', exact: true }).press('Enter');
  const editor = page.getByRole('dialog');
  await expect(editor.getByRole('heading', { name: 'Workspace owner' })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Review employee' })).toHaveCount(0);
  permissions.employees.view = false;
  await setAccess();
  await expect(table).toHaveCount(0);
});

for (const [route, title, singular] of [
  ['employeeBloodGroups', 'Blood groups', 'blood group'],
  ['employeeEmploymentTypes', 'Employment types', 'employment type'],
  ['employeeGender', 'Gender', 'gender'],
]) {
  test(title + ' uses the shared Overview, Sheet and review workflow', async ({ page }) => {
    test.skip(!!process.env.E2E_BASE_URL, 'Local preview only');
    await page.goto('/fabric.html#' + route);
    const table = page.getByRole('table', { name: title, exact: true });
    await expect(table.getByText('No matching records')).toBeVisible();
    const add = page.getByRole('button', { name: '+ Add ' + singular, exact: true });
    const dialog = page.getByRole('dialog');
    const name = dialog.getByLabel('Name', { exact: true });
    const review = dialog.getByRole('button', { name: 'Review details →', exact: true });
    const confirm = dialog.getByRole('button', { name: 'Confirm save', exact: true });
    await add.click();
    await expect(dialog).toHaveAccessibleName('New ' + singular);
    await expect(name).toBeFocused();
    await name.fill('Sample reference');
    await review.click();
    await expect(dialog.getByText('Sample reference', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Back to edit', exact: true }).click();
    await expect(name).toHaveValue('Sample reference');
    await review.click();
    await confirm.click();
    await expect(page.locator('dialog.hr-reference-editor')).toHaveCount(0);

    await table.getByRole('button', { name: 'Sample reference', exact: true }).press('Enter');
    await expect(dialog).toHaveAccessibleName('Edit ' + singular);
    await expect(name).toHaveValue('Sample reference');
    await name.fill('Unsaved change');
    await review.click();
    await page.keyboard.press('Escape');
    await expect(
      table.getByRole('button', { name: 'Sample reference', exact: true }),
    ).toBeFocused();

    await page.getByRole('button', { name: 'Sheet', exact: true }).click();
    const edit = page.getByRole('button', { name: 'Edit selected record', exact: true });
    await expect(edit).toBeDisabled();
    await expect(add).toBeVisible();
    await page.locator('.fortune-sheet-overlay').click({ position: { x: 85, y: 82 } });
    await edit.click();
    await expect(dialog).toHaveAccessibleName('Edit ' + singular);
    await expect(name).toHaveValue('Sample reference');
    await name.fill('Edited reference');
    await review.click();
    await confirm.click();
    await expect(page.locator('dialog.hr-reference-editor')).toHaveCount(0);
    await page.getByRole('main').getByRole('button', { name: 'Overview', exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Search ' + title, exact: true });
    await search.fill('no such reference');
    await expect(table.getByText('No matching records')).toBeVisible();
    await search.fill('edited');
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(
      table.getByRole('button', { name: 'Edited reference', exact: true }),
    ).toBeVisible();

    const access = initialAccess();
    access.roles.find(({ id }) => id === 'admin').permissions.employees = { view: true };
    await page.evaluate(
      (data) => localStorage.setItem('garments-access-preview-v1', JSON.stringify(data)),
      access,
    );
    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Search ' + title, exact: true })).toHaveValue(
      'edited',
    );
    await expect(table.getByRole('cell', { name: 'Edited reference', exact: true })).toBeVisible();
    await table.getByRole('cell', { name: 'Edited reference', exact: true }).click();
    await expect(table.getByRole('button', { name: 'Edited reference', exact: true })).toHaveCount(
      0,
    );
    await expect(dialog).toHaveCount(0);
    await expect(add).toHaveCount(0);
  });
}
