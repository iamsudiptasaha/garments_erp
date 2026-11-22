// Real local Supabase Auth + TOTP + PostgreSQL acceptance. No mocked business RPCs.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { chromium, expect } from '@playwright/test';
import { totp } from './billing-totp.mjs';
const runtime = JSON.parse(
  readFileSync(process.env.TEST_RUNTIME_FILE || '/tmp/erp-test-runtime.json', 'utf8'),
);
const api = new URL(runtime.API_URL),
  database = new URL(runtime.DB_URL);
assert.equal(api.hostname, '127.0.0.1');
assert.equal(api.protocol, 'http:');
assert.equal(database.hostname, '127.0.0.1');
assert.equal(Number(database.port), Number(api.port) + 1);
const app = process.env.TRANSFERABLE_UI_URL || 'http://127.0.0.1:18768';
assert.match(app, /^http:\/\/127[.]0[.]0[.]1:\d+$/);
const shots = process.env.TRANSFERABLE_SCREENSHOTS || 'fabric-poc/reports/transferable-materials';
mkdirSync(shots, { recursive: true });
const db = new pg.Client({ connectionString: runtime.DB_URL });
await db.connect();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(runtime.API_URL, runtime.SERVICE_ROLE_KEY, options);
const ok = (result) => {
  if (result.error) throw result.error;
  return result.data;
};
async function signIn(role) {
  const client = createClient(runtime.API_URL, runtime.ANON_KEY, options);
  const email = 'transfer-' + randomBytes(8).toString('hex') + '@example.invalid',
    password = randomBytes(24).toString('hex');
  const { user } = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
  const contact = (
    await db.query('insert into garments_erp.contacts(company_name) values($1) returning id', [
      email,
    ])
  ).rows[0];
  const employee = (
    await db.query(
      'insert into garments_erp.employee(employee_code,contacts_id,contact_purpose_id) values($1,$2,900001) returning id',
      ['SCE/8' + contact.id, contact.id],
    )
  ).rows[0];
  await db.query(
    'update garments_erp.employee_status set is_verified=true,verified_by_employee_id=900001 where employee_id=$1',
    [employee.id],
  );
  await db.query(
    'insert into garments_access.app_user(user_id,employee_id,is_active) values($1,$2,true)',
    [user.id, employee.id],
  );
  await db.query(
    'insert into garments_access.app_user_role(user_id,role_id) select $1,id from garments_access.app_role where key=$2',
    [user.id, role],
  );
  ok(await client.auth.signInWithPassword({ email, password }));
  const factor = ok(
    await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Transfer acceptance' }),
  );
  ok(
    await client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: totp(factor.totp.secret),
    }),
  );
  return { client, session: ok(await client.auth.getSession()).session };
}
const browser = await chromium.launch();
const errors = [];
let p;
const results = [];
const check = async (name, fn) => {
  await fn();
  results.push(name);
  console.log('PASS', name);
};
async function contextFor(session) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await c.route('https://erp-local.invalid/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: runtime.API_URL + url.pathname + url.search,
      headers: route.request().headers(),
    });
    await route.fulfill({ response });
  });
  await c.addInitScript((value) => {
    if (self === top && location.protocol === 'http:')
      localStorage.setItem('sb-erp-local-auth-token', JSON.stringify(value));
  }, session);
  c.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  return c;
}
try {
  const owner = await signIn('ci_admin');
  const context = await contextFor(owner.session);
  p = await context.newPage();
  p.setDefaultTimeout(12000);
  const dlg = () => p.locator('dialog[open]');
  const go = async (page) => {
    await p.goto(app + '/fabric.html?live=1#' + page);
  };
  const choose = async (label, name, workerId) => {
    const field = dlg().getByRole('combobox', { name: label, exact: true });
    await field.fill(name);
    const options = p.getByRole('option', { name, exact: true });
    if (workerId) {
      // Other acceptance suites may create workers sharing this Contact name.
      // The picker preserves the authorized projection's order; select its exact FK record.
      const snapshot = ok(await owner.client.rpc('erp_raw_material_transaction_snapshot'));
      const matches = snapshot.transferable_workers.filter((worker) => worker.name === name);
      const index = matches.findIndex((worker) => worker.id === workerId);
      assert(index >= 0, 'Intended worker record is available');
      await options.nth(index).click();
    } else await options.click();
  };
  let receipt;
  await check(
    'Stock In uses existing Review/Confirm and stores transferable receipt once',
    async () => {
      const receiptsBefore = (
        await db.query(
          'select count(*)::int n from garments_erp.raw_material_check_in where id<995000 and is_transferable',
        )
      ).rows[0].n;
      await go('materialReceipts');
      await p.getByRole('button', { name: '+ Receive stock', exact: true }).click();
      await p.getByLabel('Purchase order', { exact: true }).selectOption('995001');
      await p.getByLabel('Purchase order line', { exact: true }).selectOption('995001');
      await p.getByLabel('Billed quantity', { exact: true }).fill('12');
      await p.getByRole('checkbox', { name: 'Transferable', exact: true }).check();
      await p
        .getByLabel('Invoice number', { exact: true })
        .fill('TRANSFER-BROWSER-' + randomBytes(4).toString('hex'));
      await dlg().getByRole('button', { name: 'Review details →', exact: true }).click();
      assert.equal(
        (
          await db.query(
            'select count(*)::int n from garments_erp.raw_material_check_in where id<995000 and is_transferable',
          )
        ).rows[0].n,
        receiptsBefore,
      );
      const response = p.waitForResponse((r) =>
        r.url().endsWith('/rpc/erp_save_raw_material_transaction'),
      );
      await dlg().getByRole('button', { name: 'Confirm & save', exact: true }).click();
      receipt = await (await response).json();
      assert.equal(receipt.is_transferable, true);
      await dlg().waitFor({ state: 'hidden' });
    },
  );
  await check(
    'Stock Out excludes transferable receipt and existing outward save still works',
    async () => {
      await go('materialIssues');
      await p.getByRole('button', { name: '+ Record outward', exact: true }).click();
      assert.equal(
        await p
          .getByLabel('Source receipt / stock', { exact: true })
          .locator('option')
          .filter({ hasText: receipt.sku })
          .count(),
        0,
      );
      await p.getByLabel('Source receipt / stock', { exact: true }).selectOption('995003');
      await p.getByLabel('Outward quantity', { exact: true }).fill('1');
      await p.getByLabel('Outward type', { exact: true }).selectOption('995001');
      await dlg().getByRole('button', { name: 'Review details →', exact: true }).click();
      await dlg().getByRole('button', { name: 'Confirm & save', exact: true }).click();
      await dlg().waitFor({ state: 'hidden' });
    },
  );
  await go('transferableMaterials');
  await p.getByRole('heading', { name: 'Transferable Materials', exact: true }).waitFor();
  await check(
    'Overview filters and preferences restore for the same account in another browser',
    async () => {
      const search = p.getByRole('searchbox', {
        name: 'Search Transferable Materials',
        exact: true,
      });
      await search.fill(receipt.sku);
      await p.waitForTimeout(500);
      assert.equal(await p.locator('.erp-overview-table tbody tr').count(), 1);
      await p.getByRole('button', { name: 'Filter', exact: true }).click();
      await p.getByRole('button', { name: '+ Add filter rule', exact: true }).click();
      await p.getByLabel('Filter field 1', { exact: true }).selectOption('status');
      await p.getByLabel('Filter value 1', { exact: true }).fill('In Stock');
      await p.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await p.waitForTimeout(300);
      assert.equal(await p.locator('.erp-overview-table tbody tr').count(), 1);
      await p.getByRole('button', { name: /^Filter/ }).click();
      await p.getByRole('button', { name: 'Remove filter rule 1', exact: true }).click();
      await p.getByRole('button', { name: 'Close dialog', exact: true }).click();
      const same = await contextFor(owner.session);
      const other = await same.newPage();
      await other.goto(app + '/fabric.html?live=1#transferableMaterials');
      await other
        .getByRole('searchbox', { name: 'Search Transferable Materials', exact: true })
        .waitFor();
      await expect(
        other.getByRole('searchbox', { name: 'Search Transferable Materials', exact: true }),
      ).toHaveValue(receipt.sku);
      await same.close();
      await search.fill('');
      await p.waitForTimeout(500);
      const sort = p.getByRole('columnheader', { name: /Receipt SKU/ });
      await sort.click();
      await sort.click();
    },
  );
  await check(
    'Shared Overview opens exact receipt and confirms repeat movement cycle',
    async () => {
      await p.getByRole('button', { name: receipt.sku, exact: true }).click();
      const types = ['Transfer', 'Return', 'Transfer', 'Return', 'Discard', 'Restore'];
      for (const type of types) {
        await dlg().getByRole('button', { name: type, exact: true }).click();
        if (type === 'Transfer') {
          await choose('Job worker', 'Synthetic CI administrator', '995001');
          await choose('Garment item', 'TR-204 · Cotton overshirt');
        }
        await choose('Recorded by employee', 'Synthetic CI administrator');
        if (['Discard', 'Restore'].includes(type))
          await dlg()
            .getByRole('textbox', { name: 'Reason', exact: true })
            .fill(type === 'Discard' ? 'Fixture damaged' : 'Fixture repaired');
        const n = (
          await db.query(
            'select count(*)::int n from garments_erp.transferable_item_movement where raw_material_check_in_id=$1',
            [receipt.id],
          )
        ).rows[0].n;
        await dlg().getByRole('button', { name: 'Review', exact: true }).click();
        assert.equal(
          (
            await db.query(
              'select count(*)::int n from garments_erp.transferable_item_movement where raw_material_check_in_id=$1',
              [receipt.id],
            )
          ).rows[0].n,
          n,
        );
        await dlg().getByRole('button', { name: 'Confirm save', exact: true }).click();
        await dlg()
          .getByRole('button', {
            name: type === 'Transfer' ? 'Return' : type === 'Discard' ? 'Restore' : 'Transfer',
            exact: true,
          })
          .waitFor();
      }
      assert.equal(
        (
          await db.query(
            'select billed_quantity from garments_erp.raw_material_check_in where id=$1',
            [receipt.id],
          )
        ).rows[0].billed_quantity,
        '12',
      );
      assert.equal(await dlg().locator('tbody tr').count(), 6);
      await p.screenshot({ path: shots + '/history-desktop.png' });
      await p.keyboard.press('Escape');
    },
  );
  await check('Stock In locks transferability and identity after movements', async () => {
    await go('materialReceipts');
    await p.getByRole('button', { name: receipt.sku, exact: true }).click();
    assert(await p.getByRole('checkbox', { name: 'Transferable', exact: true }).isDisabled());
    assert(
      (await p.getByLabel('Billed quantity', { exact: true }).getAttribute('readonly')) !== null,
    );
    await p.screenshot({ path: shots + '/stock-in-locked.png' });
    await p.keyboard.press('Escape');
  });
  await check(
    'Stale movement review rejects competing write and keeps reviewed values',
    async () => {
      await go('transferableMaterials');
      await p.getByRole('button', { name: receipt.sku, exact: true }).click();
      await dlg().getByRole('button', { name: 'Discard', exact: true }).click();
      await choose('Recorded by employee', 'Synthetic CI administrator');
      await dlg().getByRole('textbox', { name: 'Reason', exact: true }).fill('Reviewed reason');
      await dlg().getByRole('button', { name: 'Review', exact: true }).click();
      const snapshot = ok(await owner.client.rpc('erp_raw_material_transaction_snapshot'));
      const state = snapshot.transferable_receipt_state.find((r) => r.id === receipt.id);
      ok(
        await owner.client.rpc('erp_record_transferable_movement', {
          p_receipt_id: receipt.id,
          p_expected_movement_id: state.last_movement_id,
          p_receipt_updated_at: receipt.updated_at,
          p_type_id: '3',
          p_job_worker_id: null,
          p_item_id: null,
          p_employee_id: '900001',
          p_remarks: 'Competing operator',
        }),
      );
      await dlg().getByRole('button', { name: 'Confirm save', exact: true }).click();
      await dlg().getByRole('alert').filter({ hasText: 'Receipt changed' }).waitFor();
      assert(await dlg().getByText('Reviewed reason', { exact: true }).count());
      await p.screenshot({ path: shots + '/stale-review.png' });
      await p.keyboard.press('Escape');
      await p.reload();
    },
  );
  await check(
    'Overview, Sheet, selection, protected cells and responsive approved modal',
    async () => {
      for (const width of [1440, 1024, 390]) {
        await p.setViewportSize({ width, height: 1000 });
        await go('transferableMaterials');
        await p
          .locator('.fabric-view-toggle')
          .getByRole('button', { name: 'Overview', exact: true })
          .click();
        await p.getByRole('button', { name: receipt.sku, exact: true }).waitFor();
        await p.screenshot({ path: shots + '/overview-' + width + '.png' });
        await p.getByRole('button', { name: receipt.sku, exact: true }).click();
        assert.equal(await dlg().locator('h2').textContent(), 'Transferable template set');
        assert.equal(
          await dlg().locator('.editor-heading .lab-path strong').textContent(),
          receipt.sku,
        );
        assert(!(await dlg().evaluate((el) => el.scrollWidth > el.clientWidth)));
        await p.screenshot({ path: shots + '/detail-' + width + '.png' });
        await p.keyboard.press('Escape');
        await p
          .locator('.fabric-view-toggle')
          .getByRole('button', { name: 'Sheet', exact: true })
          .click();
        await p.locator('.fortune-sheet-container').waitFor();
        await p
          .getByRole('searchbox', { name: 'Search Transferable Materials', exact: true })
          .fill(receipt.sku);
        await p.waitForTimeout(500);
        await p.locator('.fortune-sheet-overlay').click({ position: { x: 85, y: 82 } });
        await p.keyboard.press('Delete');
        await p.getByRole('button', { name: 'Open selected record', exact: true }).click();
        await dlg()
          .getByRole('heading', { name: 'Transferable template set', exact: true })
          .waitFor();
        assert.equal(await dlg().locator('.editor-heading strong').textContent(), receipt.sku);
        await p.keyboard.press('Escape');
        await p.screenshot({ path: shots + '/sheet-' + width + '.png' });
      }
    },
  );
  await check('Authenticated read-only role sees history but cannot create movements', async () => {
    await db.query(
      "insert into garments_access.app_role_resource_permission(app_role_id,app_resource_id,can_view) select role.id,r.id,true from garments_access.app_role role,garments_access.app_resource r where role.key='ci_viewer' and r.key='transferableMaterials' on conflict(app_role_id,app_resource_id) do update set can_view=true,can_create=false",
    );
    const viewer = await signIn('ci_viewer');
    const c = await contextFor(viewer.session);
    const v = await c.newPage();
    await v.goto(app + '/fabric.html?live=1#transferableMaterials');
    await v.getByRole('button', { name: receipt.sku, exact: true }).click();
    assert.equal(await v.locator('dialog[open] .lab-path button').count(), 0);
    assert.equal(await v.locator('dialog[open] tbody tr').count(), 7);
    await v.screenshot({ path: shots + '/view-only.png' });
    const denied = await viewer.client.rpc('erp_record_transferable_movement', {
      p_receipt_id: receipt.id,
      p_expected_movement_id: null,
      p_receipt_updated_at: receipt.updated_at,
      p_type_id: '4',
      p_job_worker_id: null,
      p_item_id: null,
      p_employee_id: '900001',
      p_remarks: 'Not allowed',
    });
    assert.equal(denied.error.code, '42501');
    await c.close();
    await viewer.client.auth.signOut();
  });
  assert.deepEqual(errors, []);
  console.log('PASS real Auth/TOTP/PostgreSQL Chromium acceptance: ' + results.length + ' groups');
} catch (error) {
  if (p) await p.screenshot({ path: shots + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await db.end();
}
