import { test, expect } from '@playwright/test';
import { initialAccess } from '../src/admin/model.js';

const section = (dialog, name) =>
  dialog
    .getByRole('navigation', { name: 'Contact sections' })
    .getByRole('button', { name, exact: true });

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
  await section(dialog, 'Contact items').click();
  await dialog.getByRole('button', { name: '+ Add contact item', exact: true }).click();
  await dialog.getByLabel('Contact items 1 Phone number', { exact: true }).fill('0012345');
  await section(dialog, 'Additional Details').click();
  await dialog.getByRole('button', { name: '+ Add detail', exact: true }).click();
  await dialog
    .getByLabel('Additional Details 1 Detail name', { exact: true })
    .fill('Synthetic note');
  await dialog.getByRole('button', { name: 'Review Changes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm Save', exact: true }).click();
  await page.getByRole('button', { name: 'Synthetic combined contact', exact: true }).click();
  dialog = page.getByRole('dialog');
  await section(dialog, 'Contact items').click();
  await expect(dialog.getByLabel('Contact items 1 Phone number', { exact: true })).toHaveValue(
    '0012345',
  );
  await section(dialog, 'Additional Details').click();
  await expect(dialog.getByLabel('Additional Details 1 Detail name', { exact: true })).toHaveValue(
    'Synthetic note',
  );
  const search = dialog.getByRole('searchbox', { name: 'Search additional details' });
  await search.fill('missing');
  await expect(dialog.getByText('No matching details')).toBeVisible();
  await search.fill('synthetic');
  await expect(dialog.getByLabel('Additional Details 1 Detail name')).toBeVisible();
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
    page.getByRole('button', { name: 'Synthetic contact only', exact: true }),
  ).toBeVisible();
});

test('primary choices are exclusive per category and persist on reopening', async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'No production writes');
  await page.goto('/fabric.html#materialContacts');
  await page.getByRole('button', { name: '+ Add contact', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Company / contact name', { exact: true }).fill('Synthetic primary UI');
  await section(dialog, 'Contact items').click();
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
  await section(dialog, 'Bank accounts').click();
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
  await page.getByRole('button', { name: 'Synthetic primary UI', exact: true }).click();
  await section(dialog, 'Contact items').click();
  await expect(dialog.getByLabel('Contact items 2 Primary address', { exact: true })).toBeChecked();
  await expect(dialog.getByLabel('Contact items 1 Primary phone', { exact: true })).toBeChecked();
  await section(dialog, 'Bank accounts').click();
  await expect(
    dialog.getByLabel('Bank accounts 2 Primary bank account', { exact: true }),
  ).toBeChecked();
});

test('contact sections and primary controls fit desktop, tablet and phone', async ({
  page,
}, testInfo) => {
  await page.goto('/fabric.html#materialContacts');
  await page.getByRole('button', { name: '+ Add contact', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await section(dialog, 'Contact items').click();
  await dialog.getByRole('button', { name: '+ Add contact item', exact: true }).click();
  await dialog.getByLabel('Contact items 1 Name', { exact: true }).fill('Dispatch desk');
  await dialog.getByLabel('Contact items 1 Primary address', { exact: true }).check();
  await dialog.getByLabel('Contact items 1 Primary phone', { exact: true }).check();

  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const flags = await dialog.locator('.contact-primary-toggle:visible').evaluateAll((labels) =>
      labels.map((label) => {
        const box = label.querySelector('input').getBoundingClientRect();
        const caption = label.querySelector('span').getBoundingClientRect();
        return {
          gap: caption.left - box.right,
          centerOffset: Math.abs(box.top + box.height / 2 - caption.top - caption.height / 2),
        };
      }),
    );
    expect(flags).toHaveLength(3);
    for (const flag of flags) {
      expect(flag.gap).toBeCloseTo(8);
      expect(flag.centerOffset).toBeLessThan(1);
    }
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await dialog.screenshot({ path: testInfo.outputPath(`contacts-${width}.png`) });
  }

  await section(dialog, 'Bank accounts').click();
  await dialog.getByRole('button', { name: '+ Add bank account', exact: true }).click();
  await expect(
    dialog.locator('.contact-entry-row:visible').getByLabel(/Supporting document/),
  ).toBeVisible();
  await expect(section(dialog, 'Attachments')).toHaveCount(0);
  await expect(section(dialog, 'Company Details')).toHaveCount(0);
});

test('a viewer opens the same contact interface with only permitted sections', async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Requires the sample access picker');
  const access = initialAccess();
  const viewer = access.roles.find((role) => role.id === 'viewer');
  viewer.permissions.materialContacts = { view: true };
  viewer.permissions.contactPeople = { view: true };
  const user = access.users.find((row) => row.roleId === viewer.id);
  await page.addInitScript((state) => {
    localStorage.setItem('garments-access-preview-v1', JSON.stringify(state));
  }, access);
  await page.goto('/fabric.html#materialContacts');
  await page.getByLabel('Preview access as').selectOption(user.id);
  await page
    .getByRole('table', { name: 'Contacts' })
    .locator('tbody button[aria-haspopup=dialog]')
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Basic Information' })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Is Company' })).toBeDisabled();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Review Changes' })).toHaveCount(0);
  await expect(section(dialog, 'Bank accounts')).toHaveCount(0);
  await section(dialog, 'Contact items').click();
  await expect(dialog.getByRole('button', { name: '+ Add contact item' })).toHaveCount(0);
});

test('company GST is optional, persists and clears when unchecked', async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'No production writes');
  await page.goto('/fabric.html#materialContacts');
  const dialog = page.getByRole('dialog');
  const company = dialog.getByRole('checkbox', { name: 'Is Company' });
  const gst = dialog.getByLabel('GST number', { exact: true });
  const save = async () => {
    await dialog.getByRole('button', { name: 'Review Changes', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm Save', exact: true }).click();
    await expect(dialog).toBeHidden();
  };
  const open = async (name) => {
    await page
      .getByRole('table', { name: 'Contacts' })
      .getByRole('button', { name, exact: true })
      .click();
  };
  await page.getByRole('button', { name: '+ Add contact', exact: true }).click();
  await dialog.getByLabel('Company / contact name').fill('Synthetic GST contact');
  await expect(company).not.toBeChecked();
  await expect(gst).toBeHidden();
  await save();
  await open('Synthetic GST contact');
  await company.check();
  await expect(gst).toBeEnabled();
  await save();
  await open('Synthetic GST contact');
  await expect(company).toBeChecked();
  await expect(gst).toHaveValue('');
  await gst.fill('GST-SYNTHETIC');
  await save();
  await page.reload();
  await open('Synthetic GST contact');
  await expect(gst).toHaveValue('GST-SYNTHETIC');
  await company.uncheck();
  await expect(gst).toBeHidden();
  await dialog.getByRole('button', { name: 'Review Changes', exact: true }).click();
  await expect(dialog.getByText('GST-SYNTHETIC → —')).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await open('Synthetic GST contact');
  await expect(company).not.toBeChecked();
  await expect(gst).toBeHidden();
  await company.check();
  await expect(gst).toHaveValue('');
});

test('Miscellaneous grids retain worksheet controls and persist Overview preferences', async ({
  page,
}) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Uses sample data and grid preferences');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/fabric.html#materialContacts');
  const contacts = page.getByRole('table', { name: 'Contacts', exact: true });
  await expect(page.getByRole('region', { name: 'Contacts', exact: true })).toHaveAttribute(
    'tabindex',
    '0',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page
    .getByRole('searchbox', { name: 'Search Contacts', exact: true })
    .fill('no-such-contact');
  await expect(contacts.getByText('No matching records')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search Contacts', exact: true }).clear();
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Search name / alias', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(contacts.getByRole('columnheader', { name: 'Search name / alias' })).toBeVisible();
  await page.getByRole('button', { name: 'Sheet', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Sheet zoom' })).toBeVisible();
  await expect(contacts).toHaveCount(0);

  await page.goto('/fabric.html#contactCategories');
  const purpose = page.getByRole('table', { name: 'Contact Purpose', exact: true });
  await purpose.getByRole('button', { name: 'Category name', exact: true }).click();
  await expect(purpose.getByRole('columnheader', { name: 'Category name' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('button', { name: '+ Add filter rule' }).click();
  await page.getByLabel('Filter field 1').selectOption('name');
  await page.getByLabel('Filter value 1').fill('Raw material supplier');
  await page.keyboard.press('Escape');
  const row = purpose.getByRole('row').filter({ hasText: 'Raw material supplier' });
  await expect(purpose.locator('tbody tr')).toHaveCount(1);
  await row.getByRole('cell').last().click();
  await expect(page.getByRole('dialog').getByLabel('Category name')).toHaveValue(
    'Raw material supplier',
  );
});

test('view-only Contact Purpose keeps rows visible without opening the editor', async ({
  page,
}) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Uses the sample access picker');
  const access = initialAccess();
  access.roles.find(({ id }) => id === 'admin').permissions.contactCategories = { view: true };
  await page.addInitScript((state) => {
    localStorage.setItem('garments-access-preview-v1', JSON.stringify(state));
  }, access);
  await page.goto('/fabric.html#contactCategories');
  const table = page.getByRole('table', { name: 'Contact Purpose', exact: true });
  await table.getByRole('cell', { name: 'Raw material supplier', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Add category', exact: true })).toHaveCount(0);
});
