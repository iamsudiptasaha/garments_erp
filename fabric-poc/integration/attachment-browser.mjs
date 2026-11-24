import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { totp } from './billing-totp.mjs';
import { readFileSync } from 'node:fs';
import { FILE_TARGETS } from '../src/files/model.js';
import { fileRecordPath } from '../src/access/workspace-routes.js';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { chromium } from '@playwright/test';
const runtime = JSON.parse(
  readFileSync(process.env.TEST_RUNTIME_FILE || '/tmp/erp-test-runtime.json', 'utf8'),
);
assert.match(runtime.API_URL, /^http:\/\/127[.]0[.]0[.]1:(55421|58421|59621)$/);
const dbUrl = new URL(runtime.DB_URL);
assert.equal(dbUrl.hostname, '127.0.0.1');
assert.equal(dbUrl.port, String(Number(new URL(runtime.API_URL).port) + 1));
const db = new pg.Client({ connectionString: runtime.DB_URL });
await db.connect();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(runtime.API_URL, runtime.SERVICE_ROLE_KEY, options);
const anon = createClient(runtime.API_URL, runtime.ANON_KEY, options);
function ok(result) {
  if (result.error) throw result.error;
  return result.data;
}
async function signIn(role) {
  const user = createClient(runtime.API_URL, runtime.ANON_KEY, options);
  const email = 'attachment-' + role + '-' + randomBytes(8).toString('hex') + '@example.invalid';
  const password = randomBytes(20).toString('hex');
  const { user: identity } = ok(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  const {
    rows: [contact],
  } = await db.query('insert into garments_erp.contacts(company_name) values($1) returning id', [
    email,
  ]);
  const {
    rows: [employee],
  } = await db.query(
    'insert into garments_erp.employee(employee_code,contacts_id,contact_purpose_id) values($1,$2,900001) returning id',
    ['SCE/8' + contact.id, contact.id],
  );
  await db.query(
    'update garments_erp.employee_status set is_verified=true,verified_by_employee_id=900001 where employee_id=$1',
    [employee.id],
  );
  await db.query(
    'insert into garments_access.app_user(user_id,employee_id,is_active) values($1,$2,true)',
    [identity.id, employee.id],
  );
  await db.query(
    'insert into garments_access.app_user_role(user_id,role_id) select $1,id from garments_access.app_role where key=$2',
    [identity.id, role],
  );
  ok(await user.auth.signInWithPassword({ email, password }));
  const factor = ok(
    await user.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Attachment acceptance' }),
  );
  const code = totp(factor.totp.secret);
  ok(await user.auth.mfa.challengeAndVerify({ factorId: factor.id, code }));
  return { user, session: ok(await user.auth.getSession()).session, password };
}
const { user: actor, session, password } = await signIn('ci_admin');
const { user: denied, session: viewerSession } = await signIn('ci_viewer');
const app = process.env.ATTACHMENT_UI_URL || 'http://127.0.0.1:18766';
assert.match(app, /^http:\/\/127[.]0[.]0[.]1:\d+$/);
const filesService = process.env.ATTACHMENT_FILES_SERVICE;
if (filesService) assert.equal(filesService, 'http://127.0.0.1:18765');
const browser = await chromium.launch();
async function authenticatedContext(session) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  await context.route('https://erp-local.invalid/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url:
        (filesService && url.pathname === '/functions/v1/erp-files'
          ? filesService
          : runtime.API_URL + url.pathname) + url.search,
      headers: route.request().headers(),
    });
    await route.fulfill({ response });
  });
  await context.addInitScript(
    (value) => localStorage.setItem('sb-erp-local-auth-token', JSON.stringify(value)),
    session,
  );
  return context;
}
const context = await authenticatedContext(session);
const page = await context.newPage();
page.setDefaultTimeout(7000);
page.on('pageerror', (error) => console.log('PAGE ERROR', error.message));
page.on('response', async (r) => {
  if (r.status() >= 400 && r.url().includes('erp-local.invalid'))
    console.log(
      'HTTP',
      r.status(),
      new URL(r.url()).pathname,
      (await r.text().catch(() => '')).slice(0, 250),
    );
});
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const dialog = page.getByRole('dialog');
const b = (name) => button(dialog, name);
const photoPreview = dialog.getByRole('img', { name: 'Employee photo preview' });
async function verifyPhotoPreview(screenshot) {
  await photoPreview.waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector('dialog img[alt="Employee photo preview"]');
    return image?.complete && image.naturalWidth > 0;
  });
  if (screenshot && process.env.EMPLOYEE_PHOTO_SCREENSHOTS)
    await dialog.screenshot({
      path: process.env.EMPLOYEE_PHOTO_SCREENSHOTS + '/' + screenshot + '.png',
    });
}
const pic = readFileSync(new URL('./attachment-fixture.png', import.meta.url));
const upload = async (scope, label, name) => {
  const [picker] = await Promise.all([
    page.waitForEvent('filechooser'),
    scope.getByRole('button', { name: label, exact: typeof label === 'string' }).click(),
  ]);
  await picker.setFiles({ name, mimeType: 'image/png', buffer: pic });
  newResult('Select File');
};

const hidden = () => dialog.waitFor({ state: 'hidden' });
const newOperations = ['Select File', 'Review', 'Confirm Save', 'Upload'];
const creationResults = new Set();
function newResult(operation) {
  creationResults.add(operation);
}
function reportCreation(target, failedOperation) {
  for (const operation of newOperations) {
    const status =
      operation === failedOperation
        ? 'FAIL'
        : creationResults.has(operation)
          ? 'PASS'
          : 'NOT TESTED';
    console.log(status, target.key, 'new', operation);
  }
}
const route = async (key) => {
  await page.goto(app + '/fabric.html?live=1#' + key);
  await page.getByText(/Signed in · Fabric/).waitFor();
};
async function readCurrent(target, id) {
  const {
    rows: [row],
  } = await db.query(
    `select r.${target.slot} as attachment, a.filename, o.name as object, b.public, b.id as bucket
       from garments_erp.${target.table} r
       left join garments_erp.attachments a on a.id = r.${target.slot}
       left join garments_erp.bucket_group g on g.id = a.bucket_group_id
       left join storage.buckets b on b.id = g.bucket_id
       left join storage.objects o on o.bucket_id = b.id and o.name = a.storage_path
      where r.id = $1`,
    [id],
  );
  assert.ok(row, 'Expected the owning record');
  return row;
}
async function verifySaved(target, id, name) {
  const saved = await readCurrent(target, id);
  assert.equal(saved.filename, name);
  assert.equal(saved.public, false);
  assert.ok(saved.object, 'Missing persisted Storage object');
  const args = { p_key: target.key, p_record_id: id, p_id: saved.attachment };
  assert.ok(
    (await denied.rpc('erp_read_linked_file', args)).error,
    'Unauthorized reader obtained the file',
  );
  assert.ok(
    (
      await denied.rpc('erp_remove_file_link', {
        p_key: target.key,
        p_record_id: id,
        p_previous: saved.attachment,
      })
    ).error,
    'Unauthorized account removed the file',
  );
  assert.ok(
    (await anon.storage.from(saved.bucket).download(saved.object)).error,
    'Anonymous Storage read succeeded',
  );
  const deniedStage = await denied.rpc('erp_stage_file_upload', {
    p_request: randomUUID(),
    p_key: target.key,
    p_record_id: id,
    p_previous: saved.attachment,
    p_filename: name,
    p_mime: 'image/png',
    p_size: pic.length,
    p_digest: createHash('sha256').update(pic).digest('hex'),
  });
  assert.equal(deniedStage.error?.code, '42501', 'Unauthorized account could stage an upload');
  return saved;
}
async function filesEditor(target, id) {
  await page.goto(app + fileRecordPath(target.key, { record: id }));
  const panel = page.locator('.file-panel');
  const input = panel.locator('input[type=file]');
  await input.waitFor();
  assert.ok(await input.isVisible());
  return { panel, input };
}
async function existingLifecycle(target, id, initialName) {
  const { panel, input } = await filesEditor(target, id);
  const unique = 'attachment-' + randomBytes(6).toString('hex');
  let operation = 'Select File';
  const result = (status) => console.log(status, target.key, 'existing', operation);
  const record = async (name, replace = false) => {
    const before = await readCurrent(target, id);
    operation = replace ? 'Replace: Select File' : 'Select File';
    assert.ok(await input.isVisible());
    await input.setInputFiles({ name, mimeType: 'image/png', buffer: pic });
    result('PASS');
    operation = replace ? 'Replace: Review' : 'Review';
    await button(panel, 'Review attachment').click();
    await panel.getByText(name, { exact: true }).last().waitFor();
    assert.deepEqual(await readCurrent(target, id), before, 'File changed before confirmation');
    result('PASS');
    operation = replace ? 'Replace: Confirm Save' : 'Confirm Save';
    await button(panel, 'Confirm save').click();
    result('PASS');
    operation = replace ? 'Replace: Upload' : 'Upload';
    await panel.locator('.file-list').getByText(name, { exact: true }).waitFor();
    const saved = await verifySaved(target, id, name);
    assert.notEqual(saved.attachment, before.attachment);
    result('PASS');
  };
  const download = async (label) => {
    operation = label;
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      button(panel, 'Download').click(),
    ]);
    const chunks = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), pic);
    result('PASS');
  };
  const remove = async (label) => {
    operation = label;
    const before = await readCurrent(target, id);
    await button(panel, 'Remove').click();
    await panel.getByText(before.filename, { exact: true }).last().waitFor();
    assert.deepEqual(await readCurrent(target, id), before);
    await button(panel, 'Confirm save').click();
    await panel.getByText('No files attached', { exact: true }).waitFor();
    assert.equal((await readCurrent(target, id)).attachment, null);
    result('PASS');
  };
  try {
    if (initialName) {
      await download('Download after creation');
      await remove('Clear creation upload');
    }
    await record(unique + '.png');
    await download('Download');
    await record(unique + '-replacement.png', true);
    await download('Download replacement');
    await remove('Remove');
  } catch (error) {
    result('FAIL');
    throw error;
  }
}
async function pick(scope, label, option) {
  const control = scope.getByLabel(label, { exact: true });
  const tag = await control.evaluate((el) => el.tagName);
  if (tag === 'SELECT') {
    if (option) await control.selectOption({ label: option });
    else await control.selectOption({ index: 1 });
  } else {
    await control.click();
    const choice = option
      ? scope.getByRole('option', { name: option, exact: true })
      : scope.getByRole('option').first();
    await choice.click();
  }
}
async function employee() {
  const candidate = 'Browser candidate ' + Date.now();
  const {
    rows: [contact],
  } = await db.query('insert into garments_erp.contacts(company_name) values($1) returning id', [
    candidate,
  ]);
  await route('employees');
  const add = button(page, '+ Add employee');
  await add.click();
  if (process.env.EMPLOYEE_PHOTO_SCREENSHOTS) {
    await page.waitForFunction(() =>
      [...document.querySelectorAll('dialog button')].some(
        (button) => button.textContent === 'Upload employee photo' && !button.disabled,
      ),
    );
    await dialog.screenshot({
      path: process.env.EMPLOYEE_PHOTO_SCREENSHOTS + '/employee-profile-upload.png',
    });
  }
  await upload(dialog, 'Upload employee photo', 'employee-photo.png');
  await verifyPhotoPreview('employee-profile-selected');
  await b('Contact links').click();
  await pick(dialog, 'Employee contact', candidate);
  await b('Documents').click();
  assert.equal(await b('Replace employee photo').count(), 0);
  await dialog.getByLabel('Document 1 title', { exact: true }).fill('ID document');
  await upload(dialog, 'Upload employee document 1', 'employee-document.png');
  await upload(dialog, 'Upload employee document 2', 'employee-document-2.png');
  await b('Review employee').click();
  await dialog.getByText(/Upload employee-photo.png/).waitFor();
  const { rowCount } = await db.query('select id from garments_erp.employee where contacts_id=$1', [
    contact.id,
  ]);
  assert.equal(rowCount, 0, 'Employee saved before confirmation');
  await b('Back to edit').click();
  await b('Profile').click();
  await verifyPhotoPreview();
  await b('Review employee').click();
  await dialog.getByText(/Upload employee-document.png/).waitFor();
  newResult('Review');
  await b('Confirm & save employee').click();
  newResult('Confirm Save');
  await hidden();

  const {
    rows: [record],
  } = await db.query('select id from garments_erp.employee where contacts_id=$1', [contact.id]);
  await page.getByRole('searchbox', { name: 'Search Employees', exact: true }).fill(candidate);
  await page
    .getByRole('table', { name: 'Employees' })
    .getByRole('row')
    .filter({ hasText: candidate })
    .getByRole('button')
    .click();
  await verifyPhotoPreview('employee-profile-saved');
  await b('Close').click();
  return record.id;
}
async function item() {
  await route('productionItems');
  const name = 'Browser item ' + Date.now();
  await button(page, '+ Create item').click();
  await dialog.getByLabel('Style code', { exact: true }).fill(name);
  await b('Add size').click();
  await pick(dialog, 'Size 1', 'Billing test S');
  await dialog.getByLabel('Pieces 1', { exact: true }).fill('3');
  await b('Add variant / part').click();
  await pick(dialog, 'Variant 1', 'Browser variant');
  await pick(dialog, 'Part 1', 'Billing test body');
  await upload(dialog, 'Upload item image', 'item-image.png');
  await b('Review item').click();
  await dialog.getByText(/Upload item-image.png/).waitFor();
  await b('Back to edit').click();
  await dialog.getByText('Selected: item-image.png', { exact: true }).waitFor();
  await b('Review item').click();
  newResult('Review');
  await b('Confirm save').click();
  newResult('Confirm Save');
  await hidden();
  const {
    rows: [record],
  } = await db.query('select id from garments_erp.item where style_code=$1', [name]);
  return record.id;
}
async function bill(pageKey, label, table, sourceLine) {
  if (pageKey === 'dyeBills' && !sourceLine)
    sourceLine = (
      await db.query(
        `select i.id,p.program_number number from garments_erp.dyeing_program_item i join garments_erp.dyeing_program p on p.id=i.dyeing_program_id join garments_erp.fabric_type f on f.id=i.fabric_type_id where f.name='Verification fabric' order by i.id limit 1`,
      )
    ).rows[0];
  await route(pageKey);
  const name = 'Browser ' + pageKey + ' ' + Date.now();
  await button(page, '+ New document').click();
  await dialog.getByLabel('Invoice number', { exact: true }).fill(name);
  await dialog.getByLabel('Invoice date', { exact: true }).fill('2026-11-12');
  const fields =
    pageKey === 'yarn'
      ? [
          ['Purchase order line', null],
          ['Billed quantity · kg', '8'],
          ['Billed rate / kg', '10'],
          ['Billed bags', '1'],
        ]
      : pageKey === 'knitting'
        ? [
            ['Source yarn bill line', null],
            ['Fabric type', null],
            ['Greige GSM', '150'],
            ['Yarn consumed · kg', '1'],
            ['Billed quantity · kg', '2'],
            ['Billed rate / kg', '10'],
            ['Billed rolls', '1'],
          ]
        : [
            ['Dyeing program line', null],
            ['Knitted fabric source', null],
            ['Batch number', 'BROWSER-' + Date.now()],
            ['Greige consumed · kg', '1'],
            ['Billed quantity · kg', '0.9'],
            ['Final quantity · kg', '0.8'],
            ['Dyeing rolls', '1'],
            ['Dyeing rate / kg', '10'],
          ];
  if (pageKey === 'knitting') await pick(dialog, 'Knitter');
  for (const [key, value] of fields) {
    if (value === null) {
      if (pageKey === 'dyeBills' && key === 'Dyeing program line' && sourceLine) {
        const control = dialog.getByLabel('Line 1 ' + key, { exact: true });
        if ((await control.evaluate((el) => el.tagName)) === 'SELECT')
          await control.selectOption(String(sourceLine.id));
        else {
          await control.click();
          await dialog.getByRole('option', { name: new RegExp(sourceLine.number) }).click();
        }
      } else if (pageKey === 'dyeBills' && key === 'Knitted fabric source') {
        const input = dialog.getByLabel('Line 1 ' + key, { exact: true });
        // Recorded concurrency fixtures intentionally use another fabric. Select
        // the compatible source instead of depending on global insertion order.
        if ((await input.evaluate((el) => el.tagName)) === 'SELECT') {
          const compatible = (
            await db.query(
              `select k.id from garments_erp.knitting_bill_item k join garments_erp.fabric_type f on f.id=k.fabric_type_id where f.name='Verification fabric' order by k.id limit 1`,
            )
          ).rows[0];
          await input.selectOption(String(compatible.id));
        } else {
          await input.fill('Verification fabric');
          await dialog
            .getByRole('option')
            .filter({ hasText: 'Verification fabric' })
            .first()
            .click();
        }
      } else if (pageKey === 'knitting' && key === 'Source yarn bill line') {
        const control = dialog.getByLabel('Line 1 ' + key, { exact: true });
        if ((await control.evaluate((el) => el.tagName)) === 'SELECT')
          await control.selectOption({ index: 2 });
        else {
          await control.click();
          await dialog.getByRole('option').last().click();
        }
      } else await pick(dialog, 'Line 1 ' + key);
    } else await dialog.getByLabel('Line 1 ' + key, { exact: true }).fill(value);
  }
  await upload(dialog, 'Upload ' + label, pageKey + '.png');
  const verify = async () => {
    if (pageKey === 'dyeBills') {
      const {
        rows: [actor],
      } = await db.query('select employee_id from garments_access.app_user where user_id=$1', [
        session.user.id,
      ]);
      await dialog
        .getByLabel('Verifying employee', { exact: true })
        .selectOption(String(actor.employee_id));
      await dialog.getByLabel('Verification password', { exact: true }).fill(password);
    }
  };
  await b('Review document →').click();
  await dialog.getByText(new RegExp('Upload ' + pageKey + '[.]png')).waitFor();
  await verify();
  newResult('Review');
  await b('Confirm & save document').click();
  newResult('Confirm Save');
  await hidden();
  const {
    rows: [record],
  } = await db.query('select id from garments_erp.' + table + ' where invoice_number=$1', [name]);
  if (pageKey === 'dyeBills') {
    const {
      rows: [receipt],
    } = await db.query(
      `select r.sku, r.billed_quantity, r.billed_price,
        r.bill_attachment = b.bill_attachment as attachment_synced
       from garments_erp.raw_material_check_in r
       join garments_erp.dyed_fabric_item d on d.id=r.dyed_fabric_item_id
       join garments_erp.dyed_fabric_bill b on b.id=d.dyed_fabric_bill_id
       where b.id=$1 and r.automatic_dyed_receipt`,
      [record.id],
    );
    assert.match(receipt.sku, /^FAB-9[0-9]{3}$/);
    assert.equal(Number(receipt.billed_quantity), 0.8);
    assert.equal(Number(receipt.billed_price), 33);
    assert.equal(receipt.attachment_synced, true);
  }
  return record.id;
}
async function po() {
  await route('billingBuyerPO');
  const name = 'Browser PO ' + Date.now();
  await button(page, 'New buyer PO').click();
  await dialog.getByLabel('PO number', { exact: true }).fill(name);
  await pick(dialog, 'Buyer', 'Billing test buyer');
  await dialog.getByLabel('Issue date', { exact: true }).fill('2026-11-12');
  await pick(dialog, 'Sale mode', 'Exception');
  await pick(dialog, 'ERP item / sellable product', 'Billing test · Billing test S');
  await dialog.getByLabel('Ordered pieces', { exact: true }).fill('2');
  await dialog.getByLabel('PO unit price', { exact: true }).fill('12');
  await upload(dialog, 'Upload buyer po document', 'buyer-po.png');
  await b('Review buyer PO').click();
  await dialog.getByText(/Upload buyer-po.png/).waitFor();
  newResult('Review');
  await b('Confirm save').click();
  newResult('Confirm Save');
  await hidden();
  const {
    rows: [record],
  } = await db.query('select id from garments_erp.buyer_po where po_number=$1', [name]);
  return record.id;
}

async function shade() {
  await route('labDips');
  const before = await db.query('select max(id) as id from garments_erp.lab_dip');
  await button(page, '+ Create edition').click();
  await dialog
    .getByLabel('Colour / brand')
    .selectOption({ label: 'Verification colour / Verification brand' });
  const sourceDyer = (
    await db.query(
      `select l.dyer_id from garments_erp.lab_dip l join garments_erp.lab_dip_version v on v.lab_dip_id=l.id join garments_erp.batch_no_lab_dip_version_map b on b.lab_dip_version_id=v.id where b.batch_no='BROWSER-LEGACY-STOCK'`,
    )
  ).rows[0];
  await dialog.getByLabel('Dyer').selectOption(String(sourceDyer.dyer_id));
  await upload(dialog, 'Upload shade card image', 'shade.png');
  await b('Review →').click();
  await dialog.getByText(/Upload shade.png/).waitFor();
  assert.deepEqual(
    (await db.query('select max(id) as id from garments_erp.lab_dip')).rows,
    before.rows,
  );
  newResult('Review');
  await b('Confirm & save').click();
  newResult('Confirm Save');
  await hidden();
  const {
    rows: [version],
  } = await db.query('select id from garments_erp.lab_dip_version where lab_dip_id > $1', [
    before.rows[0].id,
  ]);
  return version.id;
}

async function bankDocument() {
  await route('materialContacts');
  const name = 'Attachment contact ' + randomBytes(6).toString('hex');
  await button(page, '+ Add contact').click();
  await dialog.getByLabel('Company / contact name').fill(name);
  await b('Bank accounts').click();
  await b('+ Add bank account').click();
  await dialog.getByLabel('Bank accounts 1 Account number', { exact: true }).fill('123456789');
  const input = dialog.locator('input[type=file]');
  await input.waitFor();
  assert.ok(await input.isEnabled());
  await input.setInputFiles({ name: 'bank.png', mimeType: 'image/png', buffer: pic });
  newResult('Select File');
  await b('Review Changes').click();
  await dialog.getByText('Supporting document: bank.png', { exact: true }).waitFor();
  newResult('Review');
  await b('Confirm Save').click();
  newResult('Confirm Save');
  await hidden();
  const {
    rows: [record],
  } = await db.query(
    'select a.id from garments_erp.contact_bank_account a join garments_erp.contacts c on c.id=a.contact_id where c.company_name=$1',
    [name],
  );
  return record.id;
}

async function stockReceipt() {
  await route('materialReceipts');
  const name = 'Attachment receipt ' + randomBytes(6).toString('hex');
  await button(page, '+ Receive stock').click();
  await b('Fabric').click();
  const batch = dialog.getByLabel('Fabric batch');
  const options = await batch.locator('option').allTextContents();
  const available = options.find((label) => label.includes('BROWSER-LEGACY-STOCK'));
  assert.ok(available, 'Create a dyed fabric batch fixture before receiving stock');
  await pick(dialog, 'Fabric batch', available);
  await dialog.getByLabel('Inward date').fill('2026-11-13');
  await dialog.getByLabel('Billed quantity').fill('0.1');
  await dialog.getByLabel('Invoice number').fill(name);
  await upload(dialog, 'Upload stock receipt bill', 'receipt.png');
  await b('Review details →').click();
  await dialog.getByText(/Upload receipt.png/).waitFor();
  newResult('Review');
  await b('Confirm & save').click();
  newResult('Confirm Save');
  await hidden();
  const {
    rows: [record],
  } = await db.query('select id from garments_erp.raw_material_check_in where invoice_number=$1', [
    name,
  ]);
  return record.id;
}

async function workerBill() {
  await page.goto(app + '/production-challan.html#worker-bills');
  const name = 'Attachment worker ' + randomBytes(6).toString('hex');
  await button(page, '+ New worker bill').click();
  const editor = page.locator('dialog:visible').first();
  await editor.getByLabel('Job worker').selectOption('974001');
  await editor.getByLabel('Invoice number').fill(name);
  await editor.getByLabel('Bill date').fill('2026-11-13');
  const input = editor.getByLabel('Bill attachment');
  assert.ok(await input.isVisible());
  await input.setInputFiles({ name: 'worker.png', mimeType: 'image/png', buffer: pic });
  newResult('Select File');
  await button(editor, '+ Select challan item').click();
  await page
    .getByRole('button', { name: /Select .*CHALLAN-TEST/ })
    .first()
    .click();
  await editor.getByLabel('Billed price for item 1').fill('4');
  await button(editor, 'Review worker bill').click();
  await editor.getByText(/Upload worker.png/).waitFor();
  newResult('Review');
  await button(editor, 'Confirm save').click();
  newResult('Confirm Save');
  await editor.waitFor({ state: 'hidden' });
  const {
    rows: [record],
  } = await db.query('select id from garments_erp.job_worker_bill where invoice_number=$1', [name]);
  return record.id;
}
async function transportDocket() {
  await route('billingDispatch');
  const name = 'Attachment docket ' + randomBytes(6).toString('hex');
  await button(page, 'New transport').click();
  await dialog.getByLabel('Carrier').selectOption('982001');
  await dialog.getByLabel('Docket number').fill(name);
  await dialog.getByLabel('Pickup date').fill('2026-11-13');
  await dialog
    .getByRole('checkbox', { name: /Attachment dispatch/ })
    .first()
    .check();
  await upload(dialog, 'Upload transport docket', 'docket.png');
  await b('Review transport').click();
  await dialog.getByText(/Upload docket.png/).waitFor();
  newResult('Review');
  await b('Confirm save').click();
  newResult('Confirm Save');
  await hidden();
  const {
    rows: [record],
  } = await db.query('select id from garments_erp.transport_docket where docket_number=$1', [name]);
  return record.id;
}
async function returnBill() {
  await route('billingReturns');
  await button(page, 'Record return').click();
  await dialog
    .getByLabel('Dispatched invoice')
    .selectOption({ label: 'Attachment return · Billing test buyer' });
  await dialog.getByLabel(/Pieces for/).fill('1');
  await dialog.getByLabel(/Price for/).fill('20');
  await upload(dialog, 'Upload return bill', 'return.png');
  await b('Review return').click();
  await dialog.getByText(/Upload return.png/).waitFor();
  newResult('Review');
  await b('Confirm save').click();
  newResult('Confirm Save');
  await hidden();
  const {
    rows: [record],
  } = await db.query('select id from garments_erp.return_bill order by id desc limit 1');
  return record.id;
}

async function transportBill() {
  await route('billingDispatch');
  const name = 'Attachment freight bill ' + randomBytes(6).toString('hex');
  await button(page, 'New transport bill').click();
  await dialog.getByLabel('Invoice number').fill(name);
  await dialog.getByLabel('Invoice date').fill('2026-11-13');
  await upload(dialog, 'Upload transport bill', 'freight.png');
  await b('Review transport bill').click();
  await dialog.getByText(/Upload freight.png/).waitFor();
  newResult('Review');
  await b('Confirm save').click();
  newResult('Confirm Save');
  await hidden();
  const {
    rows: [record],
  } = await db.query('select id from garments_erp.transport_bill where invoice_number=$1', [name]);
  return record.id;
}

const creation = {
  transportBill: [transportBill, 'freight.png'],
  workerBill: [workerBill, 'worker.png'],
  transportDocket: [transportDocket, 'docket.png'],
  returnBill: [returnBill, 'return.png'],
  contactBankDocument: [bankDocument, 'bank.png'],
  rawMaterialBill: [stockReceipt, 'receipt.png'],
  buyerPO: [po, 'buyer-po.png'],
  employeePhoto: [employee, 'employee-photo.png'],
  employeeDocument1: [employee, 'employee-document.png'],
  employeeDocument2: [employee, 'employee-document-2.png'],
  itemImage: [item, 'item-image.png'],
  labDipShade: [shade, 'shade.png'],
  yarnBill: [() => bill('yarn', 'yarn bill', 'yarn_bill'), 'yarn.png'],
  knittingBill: [() => bill('knitting', 'knitting bill', 'knitting_bill'), 'knitting.png'],
  dyedBill: [() => bill('dyeBills', 'dyed fabric bill', 'dyed_fabric_bill'), 'dyeBills.png'],
};
async function viewModalFile(control, saved) {
  const response = page.context().waitForEvent('response', {
    predicate: (r) => r.url().includes('/storage/v1/object/sign/') && r.ok(),
  });
  const [tab, file] = await Promise.all([page.waitForEvent('popup'), response, control.click()]);
  assert.ok(decodeURIComponent(new URL(file.url()).pathname).endsWith('/' + saved.object));
  assert.deepEqual(await file.body(), pic);
  await tab.close();
}

const nativeEditors = {
  yarnBill: [
    'yarn',
    'Yarn bills',
    'invoice_number',
    'Browser yarn %',
    null,
    'Review document →',
    'Confirm & save document',
  ],
  knittingBill: [
    'knitting',
    'Knitting bills',
    'invoice_number',
    'Browser knitting %',
    null,
    'Review document →',
    'Confirm & save document',
  ],
  dyedBill: [
    'dyeBills',
    'Dyed fabric bills',
    'invoice_number',
    'Browser dyeBills %',
    null,
    'Review document →',
    'Confirm & save document',
  ],
  rawMaterialBill: [
    'materialReceipts',
    'Stock receipts',
    'invoice_number',
    'Attachment receipt %',
    null,
    'Review details →',
    'Confirm & save',
  ],
  itemImage: [
    'productionItems',
    'Items',
    'style_code',
    'Browser item %',
    null,
    'Review item',
    'Confirm save',
  ],
  employeePhoto: [
    'employees',
    'Employees',
    'company_name',
    'Browser candidate %',
    null,
    'Review employee',
    'Confirm & save employee',
  ],
  employeeDocument1: [
    'employees',
    'Employees',
    'company_name',
    'Browser candidate %',
    null,
    'Review employee',
    'Confirm & save employee',
  ],
  employeeDocument2: [
    'employees',
    'Employees',
    'company_name',
    'Browser candidate %',
    null,
    'Review employee',
    'Confirm & save employee',
  ],
};

async function nativeRecordModal(target, createdId) {
  const [key, title, labelColumn, pattern, action, review, confirm] = nativeEditors[target.key];
  const employee = key === 'employees';
  const stockReceipt = key === 'materialReceipts';
  const {
    rows: [row],
  } = await db.query(
    `select r.id, ${labelColumn} as name${stockReceipt ? ', r.sku' : ''} from garments_erp.${target.table} r
       ${employee ? 'join garments_erp.contacts c on c.id=r.contacts_id' : ''}
       where ${labelColumn} like $1 and
         ($2::bigint is null and r.${target.slot} is null or r.id = $2)
       order by r.id desc limit 1`,
    [pattern, createdId ?? null],
  );
  assert.ok(row, 'No previously created disposable fixture for ' + target.key);
  const open = async () => {
    await route(key);
    await page.getByRole('searchbox', { name: 'Search ' + title, exact: true }).fill(row.name);
    const openRecord =
      action === null
        ? stockReceipt
          ? button(page.getByRole('table', { name: title, exact: true }), row.sku)
          : page
              .getByRole('table', { name: title })
              .getByRole('row')
              .filter({ hasText: row.name })
              .getByRole('button')
        : button(page.locator('.overview-card').filter({ hasText: row.name }), action);
    await openRecord.click();
    if (employee && target.key !== 'employeePhoto') await b('Documents').click();
  };
  const save = async (description) => {
    const before = await readCurrent(target, row.id);
    await b(review).click();
    await dialog.getByText(description).filter({ visible: true }).first().waitFor();
    assert.deepEqual(await readCurrent(target, row.id), before);
    if (target.key === 'dyedBill') {
      const {
        rows: [operator],
      } = await db.query('select employee_id from garments_access.app_user where user_id=$1', [
        session.user.id,
      ]);
      await dialog.getByLabel('Verifying employee').selectOption(String(operator.employee_id));
      await dialog.getByLabel('Verification password', { exact: true }).fill(password);
    }
    await b(confirm).click();
    await hidden();
  };
  const field = target.label.toLowerCase();
  await open();
  if (createdId) {
    const saved = await verifySaved(target, row.id, 'employee-photo.png');
    await viewModalFile(b('View ' + field), saved);
  }
  for (const [action, suffix] of [
    ['Upload', 'new'],
    ['Replace', 'replacement'],
  ]) {
    if (createdId && action === 'Upload') continue;
    const name = target.key + '-modal-' + suffix + '.png';
    await upload(dialog, action + ' ' + field, name);
    if (target.key === 'employeePhoto') await verifyPhotoPreview();
    await save(new RegExp(name.replace('.', '[.]')));
    const saved = await verifySaved(target, row.id, name);
    await open();
    if (target.key === 'employeePhoto') await verifyPhotoPreview();
    await viewModalFile(b('View ' + field), saved);
  }
  const before = await readCurrent(target, row.id);
  await b('Remove ' + field).click();
  await save(new RegExp(before.filename.replace('.', '[.]')));
  assert.equal((await readCurrent(target, row.id)).attachment, null);
  if (target.key === 'employeePhoto') {
    await open();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('dialog button')].some(
        (button) => button.textContent === 'Upload employee photo' && !button.disabled,
      ),
    );
    assert.equal(await photoPreview.count(), 0);
    await b('Close').click();
  }
}

async function buyerPODetail(target) {
  const {
    rows: [row],
  } = await db.query(
    "select id, po_number from garments_erp.buyer_po where po_number like 'Browser PO %' and po_attachment is null order by id desc limit 1",
  );
  assert.ok(row, 'No previously created Buyer PO fixture');
  await route('billingBuyerPO');
  await page.getByRole('searchbox', { name: 'Search PO number or buyer' }).fill(row.po_number);
  await button(page, row.po_number).click();
  const panel = page.locator('.file-panel');
  await panel.getByRole('heading', { name: 'PO attachments' }).waitFor();
  const input = panel.locator('input[type=file]');
  for (const name of ['po-detail.png', 'po-detail-replacement.png']) {
    assert.ok(await input.isVisible());
    await input.setInputFiles({ name, mimeType: 'image/png', buffer: pic });
    const before = await readCurrent(target, row.id);
    await button(panel, 'Review attachment').click();
    await panel.getByText(name, { exact: true }).last().waitFor();
    assert.deepEqual(await readCurrent(target, row.id), before);
    await button(panel, 'Confirm save').click();
    await panel.locator('.file-list').getByText(name, { exact: true }).waitFor();
    const saved = await verifySaved(target, row.id, name);
    assert.notEqual(saved.attachment, before.attachment);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      button(panel, 'Download').click(),
    ]);
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), pic);
  }
  const before = await readCurrent(target, row.id);
  await button(panel, 'Remove').click();
  assert.deepEqual(await readCurrent(target, row.id), before);
  await button(panel, 'Confirm save').click();
  await panel.getByText('No files attached', { exact: true }).waitFor();
  assert.equal((await readCurrent(target, row.id)).attachment, null);
}

async function shadeModal(target) {
  const {
    rows: [row],
  } = await db.query(
    `select v.id, l.edition, v.version
       from garments_erp.lab_dip_version v
       join garments_erp.lab_dip l on l.id=v.lab_dip_id
       join garments_erp.color_map_by_brand m on m.id=l.color_map_by_brand_id
       join garments_erp.color_map c on c.id=m.color_map_id
      where c.name='Verification colour'
        and v.shade_card_image_attachment is null
        and v.version=1
        and not exists (
          select 1 from garments_erp.lab_dip_version other
          where other.lab_dip_id=l.id and other.version>v.version
        )
      order by v.id desc limit 1`,
  );
  assert.ok(row, 'No previously created Lab Dip fixture');
  const open = async () => {
    await route('labDips');
    await page
      .getByRole('table', { name: 'Lab dips', exact: true })
      .getByRole('row')
      .filter({
        has: page
          .locator('td:nth-child(3)')
          .filter({ hasText: new RegExp('^' + row.edition + '$') }),
      })
      .getByRole('button', { name: 'Verification colour', exact: true })
      .click();
    await b('Update version 1').click();
  };
  const save = async (description) => {
    const before = await readCurrent(target, row.id);
    await b('Review →').click();
    await dialog.getByText(description).filter({ visible: true }).first().waitFor();
    assert.deepEqual(await readCurrent(target, row.id), before);
    await b('Confirm & save').click();
    await hidden();
  };
  await open();
  for (const [action, name] of [
    ['Upload', 'shade-modal.png'],
    ['Replace', 'shade-modal-replacement.png'],
  ]) {
    await upload(dialog, action + ' shade card image', name);
    await save(new RegExp(name.replace('.', '[.]')));
    const saved = await verifySaved(target, row.id, name);
    await open();
    await viewModalFile(b('View shade card image'), saved);
  }
  await b('Remove shade card image').click();
  await save(/Remove shade-modal-replacement[.]png/);
  assert.equal((await readCurrent(target, row.id)).attachment, null);
}

async function workerBillModal(target) {
  const {
    rows: [row],
  } = await db.query(
    "select id, invoice_number from garments_erp.job_worker_bill where invoice_number like 'Attachment worker %' order by id desc limit 1",
  );
  assert.ok(row, 'Run against a disposable database containing an existing worker bill fixture');
  const open = async (saved) => {
    await page.goto(app + '/production-challan.html#worker-bills');
    await page.getByRole('searchbox', { name: 'Search worker bills' }).fill(row.invoice_number);
    await page
      .getByRole('table', { name: 'Worker bills', exact: true })
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: row.invoice_number, exact: true }) })
      .getByRole('button')
      .click();
    if (saved) await viewModalFile(b(saved.filename), saved);
    await b('Edit bill').click();
  };
  const save = async (description) => {
    const before = await readCurrent(target, row.id);
    await b('Review worker bill').click();
    await dialog.getByText(description).waitFor();
    assert.deepEqual(await readCurrent(target, row.id), before);
    await b('Confirm save').click();
    await hidden();
  };
  await open();
  if ((await readCurrent(target, row.id)).attachment) {
    await dialog.getByRole('checkbox', { name: /Remove attachment/ }).check();
    await save(/Remove .*png/);
    await open();
  }
  for (const name of ['worker-modal.png', 'worker-modal-replacement.png']) {
    const input = dialog.getByLabel('Bill attachment', { exact: true });
    assert.ok(await input.isVisible());
    await input.setInputFiles({ name, mimeType: 'image/png', buffer: pic });
    await save(new RegExp(name.replace('.', '[.]')));
    const saved = await verifySaved(target, row.id, name);
    await open(saved);
    await viewModalFile(b('View bill attachment'), saved);
  }
  await dialog.getByRole('checkbox', { name: /Remove attachment/ }).check();
  await save(/Remove worker-modal-replacement[.]png/);
  assert.equal((await readCurrent(target, row.id)).attachment, null);
}

async function contactBankModal(target) {
  const name = 'Owning modal ' + randomBytes(6).toString('hex');
  const {
    rows: [account],
  } = await db.query(
    `with contact as (
       insert into garments_erp.contacts(company_name) values ($1) returning id
     )
     insert into garments_erp.contact_bank_account(contact_id, account_number)
     select id, '123456789' from contact returning id`,
    [name],
  );
  const open = async () => {
    await route('materialContacts');
    await page.getByRole('searchbox', { name: 'Search Contacts', exact: true }).fill(name);
    await button(page.getByRole('table', { name: 'Contacts', exact: true }), name).click();
    await b('Bank accounts').click();
  };
  const save = async (description) => {
    const before = await readCurrent(target, account.id);
    await b('Review Changes').click();
    await dialog.getByText(description, { exact: typeof description === 'string' }).waitFor();
    assert.deepEqual(await readCurrent(target, account.id), before);
    await b('Confirm Save').click();
    await hidden();
  };
  await open();
  const input = dialog.getByLabel('Supporting document', { exact: true });
  assert.ok(await input.isVisible());
  await input.setInputFiles({ name: 'bank-modal.png', mimeType: 'image/png', buffer: pic });
  await save('Supporting document: bank-modal.png');
  const original = await verifySaved(target, account.id, 'bank-modal.png');
  await open();
  await viewModalFile(b('View supporting document'), original);
  const replacement = dialog.getByLabel('Replace supporting document', { exact: true });
  assert.ok(await replacement.isVisible());
  await replacement.setInputFiles({
    name: 'bank-modal-replacement.png',
    mimeType: 'image/png',
    buffer: pic,
  });
  await save('Supporting document: bank-modal-replacement.png');
  const updated = await verifySaved(target, account.id, 'bank-modal-replacement.png');
  assert.notEqual(updated.attachment, original.attachment);
  await open();
  await viewModalFile(b('View supporting document'), updated);
  await b('Remove supporting document').click();
  await b('Undo attachment change').click();
  assert.deepEqual(await readCurrent(target, account.id), updated);
  await b('Remove supporting document').click();
  await save(/^Remove supporting document:/);
  assert.equal((await readCurrent(target, account.id)).attachment, null);
}

const modalOnly = process.argv.includes('--owning-modal');
async function fabricPlannerWorkflow() {
  const {
    rows: [isolatedLine],
  } = await db.query(`with source as (
    select i.fabric_type_id,g.lab_dip_version_id,g.lab_dip_id,p.dyer_id from garments_erp.dyeing_program_item i
    join garments_erp.dyeing_program p on p.id=i.dyeing_program_id
    join garments_erp.dyeing_program_lab_dip g on g.id=i.dyeing_program_lab_dip_id
    join garments_erp.lab_dip l on l.id=g.lab_dip_id join garments_erp.fabric_type f on f.id=i.fabric_type_id
    where f.name='Verification fabric' and l.edition=1 order by i.id limit 1
  ), header as (insert into garments_erp.dyeing_program(date,dyer_id) select now(),dyer_id from source returning id),
  edition_group as (insert into garments_erp.dyeing_program_lab_dip(dyeing_program_id,lab_dip_id,lab_dip_version_id)
    select header.id,source.lab_dip_id,source.lab_dip_version_id from header cross join source returning id,dyeing_program_id,lab_dip_id)
  insert into garments_erp.dyeing_program_item(dyeing_program_id,dyeing_program_lab_dip_id,fabric_type_id,quantity)
    select edition_group.dyeing_program_id,edition_group.id,source.fabric_type_id,0.01 from source cross join edition_group
    returning id,(select lab_dip_id from edition_group) as lab_dip_id`);

  const {
    rows: [contrast],
  } = await db.query(
    `insert into garments_erp.lab_dip(edition,color_map_by_brand_id,dyer_id)
    select max(l.edition)+1,l.color_map_by_brand_id,l.dyer_id from garments_erp.lab_dip l
    join garments_erp.color_map_by_brand m on m.id=l.color_map_by_brand_id join garments_erp.brand_list b on b.id=m.brand_list_id
    where b.brand='Verification brand' and l.dyer_id=(select source.dyer_id from garments_erp.lab_dip source where source.id=$1)
    group by l.color_map_by_brand_id,l.dyer_id returning id`,
    [isolatedLine.lab_dip_id],
  );
  await route('productionItems');
  const style = 'Planner browser ' + randomBytes(4).toString('hex');
  await button(page, '+ Create item').click();
  await dialog.getByLabel('Style code', { exact: true }).fill(style);
  await pick(dialog, 'Brand', 'Verification brand');
  await b('Add size').click();
  await pick(dialog, 'Size 1', 'Billing test S');
  await dialog.getByLabel('Pieces 1', { exact: true }).fill('3');
  for (const [n, part] of [
    [1, 'Billing test body'],
    [2, 'Planner sleeve'],
  ]) {
    await b('Add variant / part').click();
    await pick(dialog, 'Variant ' + n, 'Browser variant');
    await pick(dialog, 'Part ' + n, part);
  }
  await pick(dialog, 'Parent of Planner sleeve', 'Billing test body');
  await b('Add fabric sub-part').click();
  await pick(dialog, 'Sub-part variant / production part 1', 'Browser variant · Planner sleeve');
  await dialog.getByLabel('Sub-part name', { exact: true }).fill('Contrast cuff');
  await pick(dialog, 'Fabric type', 'Verification fabric');
  await dialog.getByLabel('Component lab dip', { exact: true }).selectOption(String(contrast.id));
  await dialog.getByLabel('Consumption per piece · kg', { exact: true }).fill('0.025');

  // Creation remains Item-owned; Planner inspects requirements and explicitly opens editing.
  await b('Add fabric sub-part').click();
  await pick(dialog, 'Sub-part variant / production part 2', 'Browser variant · Planner sleeve');
  await dialog.getByLabel('Sub-part name', { exact: true }).nth(1).fill('Main sleeve');
  await dialog
    .getByLabel('Fabric type', { exact: true })
    .nth(1)
    .selectOption({ label: 'Verification fabric' });
  await dialog
    .getByLabel('Component lab dip', { exact: true })
    .nth(1)
    .selectOption(String(isolatedLine.lab_dip_id));
  await dialog.getByLabel('Consumption per piece · kg', { exact: true }).nth(1).fill('0.1');

  await b('Review item').click();
  await b('Confirm save').click();
  await hidden();
  await button(page, 'Fabric Planner').click();
  await page.getByRole('heading', { name: 'Fabric Planner', exact: true }).waitFor();
  const search = page.getByRole('searchbox', { name: 'Search fabric requirements' });
  await search.fill(style + ' missing');
  await page.getByText('No matching records', { exact: true }).waitFor();
  await search.fill(style);
  const requirementRows = page.locator('[data-requirement]').filter({ hasText: style });
  await requirementRows.first().waitFor();
  const openRequirement = async () => {
    await requirementRows.filter({ hasText: 'Main sleeve' }).getByRole('button').click();
    await button(page.getByRole('dialog'), 'Edit fabric requirement').click();
  };
  const selectRow = () =>
    page.locator('.fortune-sheet-overlay').click({ position: { x: 85, y: 82 } });
  await openRequirement();
  await dialog.getByLabel('Consumption per piece · kg').fill('0.125');
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      'Sub-part editor overflows at ' + width,
    );
  }
  await page.keyboard.press('Tab');
  assert.ok(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
    'Modal focus left the sub-part editor',
  );

  await b('Review consumption').click();
  const requirementQuery = `select f.id, f.consumption_per_piece_kg, v.required_kg, v.estimated_received_kg
    from garments_erp.item_part_fabric f join garments_erp.fabric_plan_estimates v on v.id=f.id
    join garments_erp.item i on i.id=v.item_id where i.style_code=$1 and f.sub_part_name='Main sleeve'`;
  assert.equal(
    Number((await db.query(requirementQuery, [style])).rows[0].consumption_per_piece_kg),
    0.1,
  );
  await b('Back to edit').click();
  assert.equal(await dialog.getByLabel('Consumption per piece · kg').inputValue(), '0.125');
  await b('Review consumption').click();
  await b('Confirm save').click();
  await hidden();
  const {
    rows: [requirement],
  } = await db.query(requirementQuery, [style]);
  assert.equal(Number(requirement.consumption_per_piece_kg), 0.125);
  assert.equal(Number(requirement.required_kg), 0.375);
  const {
    rows: [components],
  } = await db.query(
    `select count(*) as count,count(distinct f.lab_dip_id) as dips from garments_erp.item_part_fabric f join garments_erp.fabric_plan_estimates r on r.id=f.id where r.item_id=(select id from garments_erp.item where style_code=$1)`,
    [style],
  );
  assert.equal(Number(components.count), 2);
  assert.equal(Number(components.dips), 2);
  async function verifyPlannerStatuses() {
    // Search is deliberately debounced: wait for the exact filtered data before exporting.
    await page.waitForFunction((expectedStyle) => {
      const rows = [...document.querySelectorAll('[data-requirement]')];
      return rows.length === 2 && rows.every((row) => row.textContent.includes(expectedStyle));
    }, style);
    await button(page, 'Sheet View').click();
    await page.getByRole('combobox', { name: 'Sort column' }).waitFor();
    const [sheetDownload] = await Promise.all([
      page.waitForEvent('download'),
      button(page, 'Export CSV').click(),
    ]);
    const sheetBytes = [];
    for await (const chunk of await sheetDownload.createReadStream()) sheetBytes.push(chunk);
    const exported = Buffer.concat(sheetBytes)
      .toString('utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) =>
        Array.from(line.matchAll(/"((?:[^"]|"")*)"/g), (match) => match[1].replaceAll('""', '"')),
      );
    const { rows: fabricTotals } = await db.query(
      `select t.name, sum(r.required_kg) as kg from garments_erp.fabric_plan_estimates r
     join garments_erp.item i on i.id=r.item_id join garments_erp.fabric_type t on t.id=r.fabric_type_id
     where i.style_code=$1 group by t.id,t.name`,
      [style],
    );
    assert.equal(
      exported[0].length,
      7 + fabricTotals.length,
      'Only filtered fabric columns belong in Sheet',
    );
    for (const total of fabricTotals) {
      const column = exported[0].indexOf(total.name + ' · kg');
      assert.ok(column >= 6, 'Missing SQL fabric column');
      assert.equal(
        Number(exported.at(-1)[column]),
        Number(total.kg),
        'Sheet grand total differs from SQL',
      );
    }
    assert.equal(exported[0].at(-1), 'Fabric Status');
    const { rows: statuses } = await db.query(
      `select r.id,r.sub_part_name,s.type from garments_erp.fabric_plan_estimates r
     join garments_erp.item i on i.id=r.item_id
     join garments_erp.item_part_fabric_status s on s.id=r.item_part_fabric_status_id
     where i.style_code=$1`,
      [style],
    );
    for (const status of statuses) {
      const exportedRequirement = exported.filter((row) => row[4] === status.sub_part_name);
      assert.equal(exportedRequirement.length, 1);
      assert.equal(
        exportedRequirement[0].at(-1),
        status.type,
        'Sheet status must match its SQL requirement',
      );
    }
    assert.ok(
      exported
        .filter((row) => row[0].endsWith(' subtotal') || row[0] === 'Grand total')
        .every((row) => row.at(-1) === ''),
    );
    assert.equal(exported.at(-1)[0], 'Grand total');
    await button(page.getByRole('group', { name: 'Fabric Planner view' }), 'Overview').click();
    await requirementRows.filter({ hasText: 'Main sleeve' }).waitFor();
    for (const status of statuses) {
      await page
        .locator(`[data-requirement="${status.id}"]`)
        .getByText(status.type, { exact: true })
        .waitFor();
    }
  }
  await verifyPlannerStatuses();
  await search.fill(style);
  await requirementRows.filter({ hasText: 'Main sleeve' }).waitFor();
  for (const [label, status] of [
    ['On hold', 4],
    ['Reused in-house fabric', 5],
    ['Automatic', 1],
  ]) {
    await openRequirement();
    await dialog.getByLabel('Manual status', { exact: true }).selectOption({ label });
    await b('Review consumption').click();
    await b('Confirm save').click();
    await hidden();
    assert.equal(
      Number(
        (
          await db.query(
            'select item_part_fabric_status_id from garments_erp.fabric_plan_estimates where id=$1',
            [requirement.id],
          )
        ).rows[0].item_part_fabric_status_id,
      ),
      status,
    );
    await verifyPlannerStatuses();
  }

  assert.ok(
    (
      await denied.rpc('erp_save_fabric_requirement', {
        p_requirement: requirement.id,
        p_variant: null,
        p_expected: null,
        p_values: null,
      })
    ).error,
  );

  await openRequirement();
  await dialog
    .getByLabel('Dyeing program item', { exact: true })
    .selectOption(String(isolatedLine.id));
  await b('Review link').click();
  await dialog.getByText('Main sleeve', { exact: true }).waitFor();
  await b('Confirm save').click();
  await hidden();
  const {
    rows: [link],
  } = await db.query(
    `select p.dyeing_program_id from garments_erp.fabric_plan_dyeing_link l
     join garments_erp.dyeing_program_item p on p.id=l.dyeing_program_item_id
     where l.item_part_fabric_id=$1`,
    [requirement.id],
  );
  const {
    rows: [programRecord],
  } = await db.query('select program_number from garments_erp.dyeing_program where id=$1', [
    link.dyeing_program_id,
  ]);
  for (const [label, status] of [
    ['Draft', 1],
    ['Final', 2],
  ]) {
    await route('programs');
    const programTable = page.getByRole('table', { name: 'Dyeing programs', exact: true });
    await programTable
      .locator('tbody tr')
      .filter({ hasText: programRecord.program_number })
      .first()
      .getByRole('cell')
      .first()
      .click();
    await dialog.getByLabel('Program date', { exact: true }).fill('2026-11-22');
    await b(label === 'Final' ? 'Review finalization' : 'Review changes').click();
    await b('Confirm save').click();
    await hidden();
    assert.equal(
      Number(
        (
          await db.query(
            'select item_part_fabric_status_id from garments_erp.fabric_plan_estimates where id=$1',
            [requirement.id],
          )
        ).rows[0].item_part_fabric_status_id,
      ),
      status,
    );
    await button(page, 'Fabric Planner').click();
    await page.getByRole('heading', { name: 'Fabric Planner', exact: true }).waitFor();
    await search.fill(style);
    await requirementRows.filter({ hasText: 'Main sleeve' }).waitFor();
    await verifyPlannerStatuses();
  }
  await page.goto(
    app + '/fabric.html?live=1&plannerProgram=' + link.dyeing_program_id + '#fabricPlanner',
  );
  await page.getByLabel('Item', { exact: true }).selectOption({ label: style });
  await page.getByText('1 row', { exact: true }).waitFor();
  await selectRow();
  await button(page, 'Edit dyeing link').click();
  await pick(dialog, 'Dyeing program item');
  await b('Review unlink').click();
  await b('Confirm save').click();
  await hidden();
  assert.equal(
    Number(
      (
        await db.query(
          'select item_part_fabric_status_id from garments_erp.fabric_plan_estimates where id=$1',
          [requirement.id],
        )
      ).rows[0].item_part_fabric_status_id,
    ),
    1,
  );
  await selectRow();
  await button(page, 'Edit dyeing link').click();
  await pick(dialog, 'Dyeing program item');
  await b('Review link').click();
  await b('Confirm save').click();
  await hidden();

  await bill('dyeBills', 'dyed fabric bill', 'dyed_fabric_bill', {
    id: isolatedLine.id,
    number: programRecord.program_number,
  });
  const {
    rows: [covered],
  } = await db.query(requirementQuery, [style]);
  assert.equal(Number(covered.estimated_received_kg), 0.375);
  assert.equal(
    Number(
      (
        await db.query(
          'select item_part_fabric_status_id from garments_erp.fabric_plan_estimates where id=$1',
          [requirement.id],
        )
      ).rows[0].item_part_fabric_status_id,
    ),
    3,
  );
  assert.equal(
    (
      await db.query(
        'select dyed_fabric_item_id from garments_erp.raw_material_check_in where automatic_dyed_receipt group by dyed_fabric_item_id having count(*)>1',
      )
    ).rowCount,
    0,
  );

  for (const [consumption, manual, status] of [
    ['0.15', '4', 4],
    ['0.125', '', 3],
  ]) {
    await route('productionItems');
    await page
      .getByRole('table', { name: 'Items', exact: true })
      .getByRole('row')
      .filter({ hasText: style })
      .getByRole('button')
      .first()
      .click();
    await dialog
      .locator(`[id="item-component-${requirement.id}-consumption_per_piece_kg"]`)
      .fill(consumption);
    await dialog
      .locator(`[id="item-component-${requirement.id}-item_part_fabric_status_id"]`)
      .selectOption(manual);
    await b('Review item').click();
    await b('Confirm save').click();
    await hidden();
    const {
      rows: [persisted],
    } = await db.query(
      'select id,consumption_per_piece_kg,item_part_fabric_status_id from garments_erp.fabric_plan_estimates where id=$1',
      [requirement.id],
    );
    assert.equal(persisted.id, requirement.id);
    assert.equal(Number(persisted.consumption_per_piece_kg), Number(consumption));
    assert.equal(Number(persisted.item_part_fabric_status_id), status);
    await button(page, 'Fabric Planner').click();
    await page.getByRole('heading', { name: 'Fabric Planner', exact: true }).waitFor();
    await search.fill(style);
    await requirementRows.filter({ hasText: 'Main sleeve' }).waitFor();
    await verifyPlannerStatuses();
  }
  assert.equal(
    Number(
      (
        await db.query(
          `select count(*) from garments_erp.production p join garments_erp.item_part part on part.id=p.item_part_id join garments_erp.item i on i.id=part.item_id where i.style_code=$1`,
          [style],
        )
      ).rows[0].count,
    ),
    0,
  );
  await programEditorWorkflow(
    requirement.id,
    style,
    isolatedLine.lab_dip_id,
    contrast.id,
    programRecord.program_number,
  );
  console.log(
    'PASS Chromium Items sub-parts, independent dips, decimal kg, review, responsive fields, overrides, Draft/Final, link removal, verified receipt and automatic inventory',
  );
}

// Real authenticated ProgramEditor → public RPC → PostgreSQL → snapshot/reload.
async function programEditorWorkflow(requirementId, style, sourceLab, contrastLab, sourceNumber) {
  await db.query('insert into garments_erp.lab_dip_version(lab_dip_id,version) values($1,1)', [
    contrastLab,
  ]);
  await db.query(
    `insert into garments_erp.lab_dip_version_item(lab_dip_version_id,date,lab_dip_status_id)
    select v.id,current_date,s.id from garments_erp.lab_dip_version v cross join garments_erp.lab_dip_version_status s
    where v.lab_dip_id=$1 and v.version=1 and s.sort_order=3`,
    [contrastLab],
  );
  await db.query('insert into garments_erp.lab_dip_version(lab_dip_id,version) values($1,2)', [
    contrastLab,
  ]);
  const contrastEdition = (
    await db.query('select edition from garments_erp.lab_dip where id=$1', [contrastLab])
  ).rows[0].edition;
  const extra = (
    await db.query(
      `insert into garments_erp.item_part_fabric(variant_item_id,fabric_type_id,lab_dip_id,sub_part_name,consumption_per_piece_kg)
    select variant_item_id,fabric_type_id,lab_dip_id,'Editor extra sleeve',0.025 from garments_erp.item_part_fabric where id=$1 returning id`,
      [requirementId],
    )
  ).rows[0];
  const colour = 'Verification colour';
  const ed = page.getByRole('dialog', { name: 'Dyeing Program', exact: true });
  const choose = async (scope, label, text) => {
    const input = scope.getByRole('combobox', { name: label, exact: true });
    await input.fill(text);
    await scope.getByRole('option').filter({ hasText: text }).first().click();
  };
  const addManual = async (edition, quantity) => {
    await button(ed, 'Add manual row').click();
    const modal = page.getByRole('dialog', { name: 'Add manual fabric requirement', exact: true });
    await choose(modal, 'Lab Dip edition', `${colour} · Edition ${edition}`);
    assert.equal(
      await modal.getByRole('combobox', { name: 'Explicit version', exact: true }).inputValue(),
      '',
    );
    await choose(modal, 'Explicit version', 'Version 1');
    await choose(modal, 'Fabric type', 'Verification fabric');
    await modal.getByRole('spinbutton', { name: 'Ordered kg', exact: true }).fill(String(quantity));
    await button(modal, 'Add manual row').click();
  };
  await route('programs');
  // SQL fixture setup happened after the previous workspace load. A hash-only
  // navigation intentionally retains the existing workspace snapshot.
  await page.reload();
  await button(page, '+ New document').click();
  const initialSnapshot = ok(await actor.rpc('erp_fabric_snapshot'));
  const sourceDyer = initialSnapshot.lab_dip.find((l) => l.id === String(sourceLab)).dyer_id;
  await ed.getByRole('combobox', { name: 'Dyer', exact: true }).click();
  await ed
    .getByRole('option')
    .nth(initialSnapshot.dyer.findIndex((d) => d.id === sourceDyer))
    .click();
  const date = '2026-11-24';
  await ed.getByLabel('Program date', { exact: true }).fill(date);
  await addManual(1, 70);
  await addManual(contrastEdition, 3.25);
  await choose(ed, `${colour} · Edition 1 Source Program`, sourceNumber);
  await choose(ed, `${colour} · Edition 1 Batch No.`, 'BROWSER-LEGACY-STOCK');
  await button(ed, 'Manage Rows').click();
  const managed = page.getByRole('dialog', { name: 'Manage Program Rows', exact: true });
  await button(managed, 'Manage Links').first().click();
  const picker = page.getByRole('dialog', { name: 'Fabric Planner · Add to Program', exact: true });
  await picker.getByRole('checkbox', { name: new RegExp(style + '.*Main sleeve') }).check();
  await picker.getByRole('checkbox', { name: new RegExp(style + '.*Editor extra sleeve') }).check();
  await button(picker, 'Review complete links').click();
  const linksReview = page.getByRole('dialog', {
    name: 'Reconfirm Complete Planner Links',
    exact: true,
  });
  await linksReview.getByText('Added', { exact: true }).first().waitFor();
  await button(linksReview, 'Confirm complete links').click();
  await button(ed, 'Manage Rows').click();
  await managed
    .getByRole('spinbutton', { name: 'Verification fabric ordered kg', exact: true })
    .first()
    .fill('55');
  await button(managed, 'Close').click();
  await button(ed, 'Review changes').click();
  await button(ed, 'Confirm save').click();
  await ed.waitFor({ state: 'hidden' });
  const created = (
    await db.query(
      `select p.id,p.program_number,g.id group_id,i.id item_id,i.quantity,g.source_dyeing_program_id,g.batch_no
    from garments_erp.dyeing_program p join garments_erp.dyeing_program_lab_dip g on g.dyeing_program_id=p.id
    join garments_erp.dyeing_program_item i on i.dyeing_program_lab_dip_id=g.id
    where g.lab_dip_id=$1 and exists(select 1 from garments_erp.fabric_plan_dyeing_link l where l.dyeing_program_item_id=i.id and l.item_part_fabric_id=$2)
    order by p.id desc limit 1`,
      [sourceLab, extra.id],
    )
  ).rows[0];
  assert.ok(created);
  assert.equal(Number(created.quantity), 55);
  assert.ok(created.source_dyeing_program_id);
  assert.ok(created.batch_no);
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from garments_erp.dyeing_program_lab_dip where dyeing_program_id=$1',
        [created.id],
      )
    ).rows[0].n,
    2,
  );
  const open = async () => {
    await route('programs');
    await page.reload();
    await page
      .getByRole('table', { name: 'Dyeing programs', exact: true })
      .getByRole('button', { name: created.program_number, exact: true })
      .click();
  };
  await open();
  await ed.getByText('Approved from Previous Program', { exact: true }).waitFor();
  await ed.getByText(sourceNumber, { exact: true }).first().waitFor();
  await button(ed, 'Manage Rows').click();
  await button(managed, 'Manage Links').first().click();
  assert.equal(
    await picker.getByRole('checkbox', { name: new RegExp(style + '.*Main sleeve') }).isChecked(),
    true,
  );
  assert.equal(
    await picker
      .getByRole('checkbox', { name: new RegExp(style + '.*Editor extra sleeve') })
      .isChecked(),
    true,
  );
  // Removal preserves the manual quantity and the unrelated edition/item.
  await picker
    .getByRole('checkbox', { name: new RegExp(style + '.*Editor extra sleeve') })
    .uncheck();
  await button(picker, 'Review complete links').click();
  await button(linksReview, 'Confirm complete links').click();
  await button(ed, 'Review changes').click();
  await button(ed, 'Confirm save').click();
  await ed.waitFor({ state: 'hidden' });
  assert.equal(
    Number(
      (
        await db.query('select quantity from garments_erp.dyeing_program_item where id=$1', [
          created.item_id,
        ])
      ).rows[0].quantity,
    ),
    55,
  );
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from garments_erp.fabric_plan_dyeing_link where dyeing_program_item_id=$1',
        [created.item_id],
      )
    ).rows[0].n,
    1,
  );
  // Concurrent change after review must fail atomically through the real UI/RPC.
  await open();
  await ed.getByLabel('Program date', { exact: true }).fill('2026-11-23');
  await button(ed, 'Review changes').click();
  await db.query('update garments_erp.dyeing_program_item set quantity=56 where id=$1', [
    created.item_id,
  ]);
  await button(ed, 'Confirm save').click();
  await ed
    .getByRole('alert')
    .filter({ hasText: /changed/ })
    .waitFor();
  assert.notEqual(
    (
      await db.query('select date::date::text date from garments_erp.dyeing_program where id=$1', [
        created.id,
      ])
    ).rows[0].date,
    '2026-11-23',
  );
  await button(ed, 'Back to edit').click();
  await button(ed, 'Cancel').click();
  // A reloaded edit can finalize explicitly; no automatic Final transition.
  await open();
  await button(ed, 'Review finalization').click();
  await button(ed, 'Confirm save').click();
  await ed.waitFor({ state: 'hidden' });
  assert.equal(
    Number(
      (
        await db.query(
          'select dyeing_program_status_id from garments_erp.dyeing_program where id=$1',
          [created.id],
        )
      ).rows[0].dyeing_program_status_id,
    ),
    2,
  );
  const protectedItem = (
    await db.query(
      `select i.id,g.id group_id,g.lab_dip_version_id from garments_erp.dyeing_program_item i join garments_erp.dyeing_program_lab_dip g on g.id=i.dyeing_program_lab_dip_id where i.dyeing_program_id=$1 and g.lab_dip_id=$2`,
      [created.id, contrastLab],
    )
  ).rows[0];
  await db.query('begin');
  const receipt = (
    await db.query(
      `insert into garments_erp.dyed_fabric_item(dyed_fabric_bill_id,dyeing_program_item_id,knitting_bill_item_id,gross_quantity,billed_quantity,final_quantity,dyeing_rate)
    select d.dyed_fabric_bill_id,$1,d.knitting_bill_item_id,1,1,1,d.dyeing_rate from garments_erp.dyed_fabric_item d join garments_erp.batch_no_lab_dip_version_map b on b.dyed_fabric_item_id=d.id where b.batch_no='BROWSER-LEGACY-STOCK' returning id`,
      [protectedItem.id],
    )
  ).rows[0];
  await db.query(
    'insert into garments_erp.batch_no_lab_dip_version_map(dyed_fabric_item_id,lab_dip_version_id,batch_no) values($1,$2,$3)',
    [receipt.id, protectedItem.lab_dip_version_id, 'EDITOR-LOCK-' + created.id],
  );
  await db.query('commit');
  await open();
  await choose(ed, `${colour} · Edition ${contrastEdition} version`, 'Version 2');
  await button(ed, 'Review changes').click();
  await ed
    .getByRole('alert')
    .filter({ hasText: /provenance/ })
    .waitFor();
  await button(ed, 'Cancel').click();
  const canonical = ok(await actor.rpc('erp_fabric_snapshot'));
  const existingGroup = canonical.dyeing_program_lab_dip.find(
    (g) => g.id === String(protectedItem.group_id),
  );
  const locked = await actor.rpc('erp_save_fabric_document', {
    p_resource: 'programs',
    p_root: {
      table: 'dyeing_program',
      id: String(created.id),
      before: canonical.dyeing_program.find((p) => p.id === String(created.id)),
    },
    p_action: 'edit',
    p_changes: [
      {
        table: 'dyeing_program_lab_dip',
        id: existingGroup.id,
        before: existingGroup,
        values: {
          dyeing_program_id: String(created.id),
          lab_dip_id: String(contrastLab),
          lab_dip_version_id: canonical.lab_dip_version.find(
            (v) => v.lab_dip_id === String(contrastLab) && Number(v.version) === 2,
          ).id,
          batch_no: null,
          source_dyeing_program_id: null,
        },
      },
    ],
  });
  assert.equal(locked.error?.code, '23514');
  const failure = await denied.rpc('erp_save_fabric_document', {
    p_resource: 'programs',
    p_root: {
      table: 'dyeing_program',
      id: String(created.id),
      before: canonical.dyeing_program.find((p) => p.id === String(created.id)),
    },
    p_action: 'edit',
    p_changes: [
      {
        table: 'dyeing_program',
        id: String(created.id),
        before: canonical.dyeing_program.find((p) => p.id === String(created.id)),
        values: { date: '2026-11-25' },
      },
    ],
  });
  assert.equal(failure.error?.code, '42501');
  // Empty Draft groups must survive save/reload and remain in the ordinary list.
  const previousMax = (await db.query('select max(id) id from garments_erp.dyeing_program')).rows[0]
    .id;
  await route('programs');
  await page.reload();
  await button(page, '+ New document').click();
  await ed.getByRole('combobox', { name: 'Dyer', exact: true }).click();
  await ed
    .getByRole('option')
    .nth(initialSnapshot.dyer.findIndex((d) => d.id === sourceDyer))
    .click();
  await addManual(1, 0);
  await button(ed, 'Manage Rows').click();
  await button(managed, 'Remove Row').click();
  await button(managed, 'Close').click();
  await button(ed, 'Review changes').click();
  await button(ed, 'Confirm save').click();
  await ed.waitFor({ state: 'hidden' });
  const empty = (
    await db.query(
      'select id,program_number from garments_erp.dyeing_program where id>$1 order by id desc limit 1',
      [previousMax],
    )
  ).rows[0];
  assert.ok(empty);
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from garments_erp.dyeing_program_item where dyeing_program_id=$1',
        [empty.id],
      )
    ).rows[0].n,
    0,
  );
  await page.reload();
  await page
    .getByRole('table', { name: 'Dyeing programs', exact: true })
    .getByRole('button', { name: empty.program_number, exact: true })
    .click();
  await ed.getByText('Status: Draft', { exact: true }).waitFor();
  await button(ed, 'Review finalization').click();
  await ed
    .getByRole('alert')
    .filter({ hasText: /Final programs require/ })
    .waitFor();
  await button(ed, 'Cancel').click();
  console.log(
    'PASS authenticated ProgramEditor multi-edition create, unapproved version, explicit reuse/batch, complete links, manual override, removal, reload, stale review, Final, receipt provenance and denied writes',
  );
}

async function contactPurposeWorkflow() {
  const route = '/fabric.html?live=1#contactCategories';
  const name = 'Chromium purpose ' + randomUUID();
  const renamed = name + ' renamed';
  await page.goto(app + route);
  const table = page.getByRole('table', { name: 'Contact Purpose', exact: true });
  await table.getByRole('button', { name: 'CI fixture', exact: true }).waitFor();

  await button(page, '+ Add category').click();
  await dialog.getByLabel('Category name').fill(name);
  await b('Review details →').click();
  await dialog.getByText(name, { exact: true }).waitFor();
  await b('Confirm & save').click();
  await table.getByRole('button', { name, exact: true }).waitFor();
  const saved = (
    await db.query('select id from garments_erp.contact_purpose where type=$1', [name])
  ).rows[0];
  assert.ok(saved?.id, 'Create must persist a database-generated ID');

  await page.getByRole('searchbox', { name: 'Search Contact Purpose', exact: true }).fill(name);
  await table.getByRole('button', { name: 'CI fixture', exact: true }).waitFor({ state: 'hidden' });
  await table
    .getByRole('row', { name: new RegExp(name) })
    .getByRole('cell')
    .last()
    .click();
  assert.equal(await dialog.getByLabel('Category name').inputValue(), name);
  await dialog.getByLabel('Category name').fill(renamed);
  await b('Review details →').click();
  await b('Confirm & save').click();
  await table.getByRole('button', { name: renamed, exact: true }).waitFor();
  assert.equal(
    (await db.query('select type from garments_erp.contact_purpose where id=$1', [saved.id]))
      .rows[0].type,
    renamed,
  );

  await page.reload();
  await table.getByRole('button', { name: renamed, exact: true }).waitFor();
  await button(page, 'Sheet').click();
  await page.getByRole('combobox', { name: 'Sheet zoom' }).waitFor();
  await button(page, 'Print / PDF').click();
  await page
    .locator('.fabric-print-dialog')
    .getByRole('cell', { name: renamed, exact: true })
    .waitFor();

  const viewerContext = await authenticatedContext(viewerSession);
  try {
    const viewer = await viewerContext.newPage();
    assert.equal((await denied.rpc('erp_contact_purpose_workspace')).error?.code, '42501');
    await viewer.goto(app + route);
    const viewerTable = viewer.getByRole('table', { name: 'Contact Purpose', exact: true });
    await viewer.getByRole('heading', { name: 'Access restricted', exact: true }).waitFor();
    const grant = await db.query(`
      insert into garments_access.app_role_resource_permission(app_role_id,app_resource_id,can_view)
      select role.id,resource.id,true from garments_access.app_role role,garments_access.app_resource resource
      where role.key='ci_viewer' and resource.key='contactCategories' returning id
    `);
    try {
      await viewer.reload();
      const cell = viewerTable.getByRole('cell', { name: renamed, exact: true });
      await cell.click();
      assert.equal(await viewer.getByRole('dialog').count(), 0);
      assert.equal(await button(viewer, '+ Add category').count(), 0);
      assert.equal(
        (
          await denied.rpc('erp_save_contact_purpose', {
            p_id: saved.id,
            p_type: 'Unauthorized rename',
            p_expected: null,
          })
        ).error?.code,
        '42501',
      );
    } finally {
      await db.query('delete from garments_access.app_role_resource_permission where id=$1', [
        grant.rows[0].id,
      ]);
    }
  } finally {
    await viewerContext.close();
    await db.query('delete from garments_erp.contact_purpose where id=$1', [saved.id]);
  }
  console.log(
    'PASS Contact Purpose live Overview, search, create, rename, reload, Sheet and permissions',
  );
}

const purposeOnly = process.argv.includes('--contact-purpose');
const plannerOnly = process.argv.includes('--fabric-planner');
const photoOnly = process.argv.includes('--employee-profile');
const selected = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith('--')));
const completed = new Map();
for (const key of selected)
  assert.ok(
    FILE_TARGETS.some((target) => target.key === key),
    key,
  );
let failed = false;
try {
  const configured = ok(await actor.rpc('erp_file_routes'));
  assert.deepEqual(
    configured.map(({ key }) => key).sort(),
    FILE_TARGETS.map(({ key }) => key).sort(),
  );
  if (plannerOnly) await fabricPlannerWorkflow();
  if (purposeOnly) await contactPurposeWorkflow();
  if (photoOnly) {
    const target = FILE_TARGETS.find(({ key }) => key === 'employeePhoto');
    await nativeRecordModal(target, await employee());
    console.log(
      'PASS employeePhoto Profile selection, review, save, preview, view, replace and remove',
    );
  }
  if (modalOnly) {
    for (const [key, run] of Object.entries({
      contactBankDocument: contactBankModal,
      workerBill: workerBillModal,
      labDipShade: shadeModal,
      buyerPO: buyerPODetail,
      ...Object.fromEntries(Object.keys(nativeEditors).map((key) => [key, nativeRecordModal])),
    })) {
      if (selected.size && !selected.has(key)) continue;
      try {
        await run(FILE_TARGETS.find((target) => target.key === key));
        console.log('PASS', key, 'owning modal upload, view, replace and remove');
      } catch (error) {
        failed = true;
        console.error('FAIL', key, error);
        console.error(await dialog.locator('[role=alert]').allTextContents());
      }
    }
  }
  for (const target of modalOnly || photoOnly || plannerOnly || purposeOnly ? [] : FILE_TARGETS) {
    if (selected.size && !selected.has(target.key)) continue;
    let id;
    const create = creation[target.key];
    if (create) {
      try {
        const [run, name] = create;
        creationResults.clear();
        if (!completed.has(run)) completed.set(run, await run());
        id = completed.get(run);
        for (const operation of newOperations.slice(0, -1)) newResult(operation);
        await verifySaved(target, id, name);
        newResult('Upload');
        reportCreation(target);
      } catch (error) {
        failed = true;
        id = null;
        reportCreation(
          target,
          newOperations.find((operation) => !creationResults.has(operation)),
        );
        console.error('FAIL', target.key, 'creation lifecycle:', error.message);
        console.error(await dialog.locator('[role=alert]').allTextContents());
      }
    } else {
      failed = true;
      console.error('NOT TESTED', target.key, 'creation lifecycle');
    }
    try {
      if (!id) {
        console.error('NOT TESTED', target.key, 'existing lifecycle without its created fixture');
        continue;
      }
      await existingLifecycle(
        target,
        id,
        create && completed.get(create[0]) === id ? create[1] : undefined,
      );
    } catch (error) {
      failed = true;
      console.error('FAIL', target.key, 'existing lifecycle:', error.message);
    }
  }
} finally {
  await context.unrouteAll({ behavior: 'wait' });
  await browser.close();
  await db.end();
}
if (failed) process.exitCode = 1;
