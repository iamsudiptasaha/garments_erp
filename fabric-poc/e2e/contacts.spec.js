import { test, expect } from '@playwright/test';
test('contact entry saves optional child sections together and reopens them for edit', async ({
  page,
}) => {
  test.skip(!!process.env.E2E_BASE_URL, 'No production writes');
  await page.goto('/fabric.html#materialContacts');
  await page.getByRole('button', { name: '+ Add contact', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Company / contact name', { exact: true })
    .fill('Synthetic combined contact');
  await dialog.getByRole('button', { name: 'Contact items', exact: true }).click();
  await dialog.getByRole('button', { name: '+ Add contact item', exact: true }).click();
  await dialog.getByLabel('Contact items 1 Phone number', { exact: true }).fill('0012345');
  await dialog.getByRole('button', { name: 'Extra data', exact: true }).click();
  await dialog.getByRole('button', { name: '+ Add detail', exact: true }).click();
  await dialog.getByLabel('Extra data 1 Detail name', { exact: true }).fill('Synthetic note');
  await dialog.getByRole('button', { name: 'Review Changes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit →', exact: true }).last().click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Contact items', exact: true }).click();
  await expect(dialog.getByLabel('Contact items 1 Phone number', { exact: true })).toHaveValue(
    '0012345',
  );
  await dialog.getByRole('button', { name: 'Extra data', exact: true }).click();
  await expect(dialog.getByLabel('Extra data 1 Detail name', { exact: true })).toHaveValue(
    'Synthetic note',
  );
  await dialog.getByRole('button', { name: 'Bank accounts', exact: true }).click();
  await expect(dialog.getByLabel('Bank accounts 1 Account number', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.goto('/fabric.html#contactPeople');
  await expect(page.getByRole('heading', { name: 'Contact items', exact: true })).toBeVisible();
  await expect(page.getByText('0012345', { exact: true })).toBeVisible();
});
test('a contact can be saved with no items, bank accounts or extra data', async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'No production writes');
  await page.goto('/fabric.html#materialContacts');
  await page.getByRole('button', { name: '+ Add contact', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Company / contact name', { exact: true }).fill('Synthetic contact only');
  await dialog.getByRole('button', { name: 'Review Changes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm Save', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Synthetic contact only', exact: true }),
  ).toBeVisible();
});

test('primary choices are exclusive per category and persist on reopening', async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'No production writes');
  await page.goto('/fabric.html#materialContacts');
  await page.getByRole('button', { name: '+ Add contact', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Company / contact name', { exact: true }).fill('Synthetic primary UI');
  await dialog.getByRole('button', { name: 'Contact items', exact: true }).click();
  for (const number of [1, 2]) {
    await dialog.getByRole('button', { name: '+ Add contact item', exact: true }).click();
    await dialog
      .getByLabel(`Contact items ${number} Address`, { exact: true })
      .fill('Synthetic address ' + number);
    await dialog.getByLabel(`Contact items ${number} Primary address`, { exact: true }).check();
  }
  await expect(
    dialog.getByLabel('Contact items 1 Primary address', { exact: true }),
  ).not.toBeChecked();
  await dialog.getByLabel('Contact items 1 Primary phone', { exact: true }).check();
  await expect(dialog.getByLabel('Contact items 2 Primary address', { exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Bank accounts', exact: true }).click();
  for (const number of [1, 2]) {
    await dialog.getByRole('button', { name: '+ Add bank account', exact: true }).click();
    await dialog
      .getByLabel(`Bank accounts ${number} Account number`, { exact: true })
      .fill('000' + number);
    await dialog
      .getByLabel(`Bank accounts ${number} Primary bank account`, { exact: true })
      .check();
  }
  await expect(
    dialog.getByLabel('Bank accounts 1 Primary bank account', { exact: true }),
  ).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Review Changes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit →', exact: true }).last().click();
  await dialog.getByRole('button', { name: 'Contact items', exact: true }).click();
  await expect(dialog.getByLabel('Contact items 2 Primary address', { exact: true })).toBeChecked();
  await expect(dialog.getByLabel('Contact items 1 Primary phone', { exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Bank accounts', exact: true }).click();
  await expect(
    dialog.getByLabel('Bank accounts 2 Primary bank account', { exact: true }),
  ).toBeChecked();
});
