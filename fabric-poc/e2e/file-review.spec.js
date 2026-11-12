import { test, expect } from '@playwright/test';

test('private attachment review retains the file after failure and respects view-only access', async ({
  page,
}) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Uses local authenticated fixtures');
  const actor = '00000000-0000-4000-8000-000000000003';
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, exp, aal: 'aal2' })}.synthetic`;
  await page.addInitScript(
    ({ actor, token, exp }) => {
      localStorage.setItem(
        'sb-example-auth-token',
        JSON.stringify({
          access_token: token,
          refresh_token: 'synthetic',
          expires_at: exp,
          token_type: 'bearer',
          user: { id: actor, aud: 'authenticated', role: 'authenticated' },
        }),
      );
    },
    { actor, token, exp },
  );
  let canEdit = true;
  let uploads = 0;
  let removals = 0;
  let reads = 0;
  let reviewedRequest;
  await page.route('https://example.invalid/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (name === 'erp-files') {
      const body = route.request().postData();
      if (body?.startsWith('{')) {
        expect(JSON.parse(body)).toMatchObject({
          action: 'read',
          targetKey: 'yarnBill',
          recordId: '12',
          attachmentId: '14',
          download: true,
        });
        reads++;
        return route.fulfill({ json: { url: 'https://example.invalid/signed' } });
      }
      uploads++;
      expect(body).toContain('receipt.pdf');
      expect(body).toContain('name="previousAttachmentId"');
      const requestId = body?.match(/name="requestId"\r\n\r\n([a-f0-9-]+)/)?.[1];
      expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
      reviewedRequest ??= requestId;
      expect(requestId).toBe(reviewedRequest);
      return uploads === 1
        ? route.fulfill({ status: 503, json: { error: 'Storage unavailable' } })
        : route.fulfill({ json: { id: '14' } });
    }
    if (name === 'erp_remove_file_link') {
      expect(route.request().postDataJSON()).toEqual({
        p_key: 'yarnBill',
        p_record_id: '12',
        p_previous: '14',
      });
      removals++;
      return route.fulfill({ json: null });
    }
    const fixtures = {
      erp_grid_preferences: {},
      erp_account_security: { enabled: true, ready: true },
      erp_access_snapshot: {
        actor,
        enabled: true,
        permissions: { yarn: { view: true, edit: canEdit } },
      },
      erp_file_registry: [
        {
          id: 'bills',
          group: 'bills',
          bucket_id: 'private-bills',
          private: true,
          max_bytes: 1048576,
        },
      ],
      erp_file_routes: [
        {
          key: 'yarnBill',
          table: 'yarn_bill',
          slot: 'bill_attachment',
          resource: 'yarn',
          group: 'bills',
          mime: ['application/pdf'],
          enabled: true,
        },
      ],
      erp_file_records: [{ id: '12', label: 'Test invoice' }],
      erp_file_list:
        uploads > 1 && removals === 0
          ? [{ id: '14', filename: 'receipt.pdf', file_size: 8, mime_type: 'application/pdf' }]
          : [],
    };
    expect(fixtures[name], name).toBeDefined();
    await route.fulfill({ json: fixtures[name] });
  });

  async function selectRecord() {
    await page.getByRole('combobox', { name: 'Saved record' }).click();
    await page.getByRole('option', { name: 'Test invoice · #12' }).click();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/files.html');
  await selectRecord();
  await page.locator('input[type=file]').setInputFiles({
    name: 'receipt.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });
  await page.getByRole('button', { name: 'Review attachment' }).click();
  const review = page.getByRole('region', { name: 'Review attachment' });
  await expect(review.getByText('receipt.pdf')).toBeVisible();
  expect(uploads).toBe(0);
  await review.getByRole('button', { name: 'Back to edit' }).click();
  await expect(page.locator('input[type=file]')).toHaveValue(/receipt[.]pdf$/);
  await page.getByRole('button', { name: 'Review attachment' }).click();
  await review.getByRole('button', { name: 'Confirm save' }).click();
  await expect(review.getByRole('alert')).toContainText('Storage unavailable');
  await review.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page.getByText('Attachment saved.')).toBeVisible();
  expect(uploads).toBe(2);

  canEdit = false;
  await page.reload();
  await selectRecord();
  await expect(page.getByText('receipt.pdf')).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Download' }).click();
  await expect.poll(() => reads).toBe(1);

  canEdit = true;
  await page.goto('/files.html?target=yarnBill&record=12');
  await page.getByRole('button', { name: 'Remove' }).click();
  const removal = page.getByRole('region', { name: 'Review attachment removal' });
  await expect(removal.getByText('receipt.pdf')).toBeVisible();
  expect(removals).toBe(0);
  await removal.getByRole('button', { name: 'Back to edit' }).click();
  await expect(page.getByText('receipt.pdf')).toBeVisible();
  expect(removals).toBe(0);
  await page.getByRole('button', { name: 'Remove' }).click();
  await removal.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page.getByText('Attachment removed.')).toBeVisible();
  await expect(page.getByText('receipt.pdf')).toHaveCount(0);
  expect(removals).toBe(1);
});
