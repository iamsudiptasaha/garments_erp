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
assert.match(runtime.API_URL, /^http:\/\/127[.]0[.]0[.]1:(55421|58421)$/);
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
const { user: denied } = await signIn('ci_viewer');
const app = process.env.ATTACHMENT_UI_URL || 'http://127.0.0.1:18766';
assert.match(app, /^http:\/\/127[.]0[.]0[.]1:\d+$/);
const filesService = process.env.ATTACHMENT_FILES_SERVICE;
if (filesService) assert.equal(filesService, 'http://127.0.0.1:55426');
const browser = await chromium.launch();
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
async function bill(pageKey, label, table) {
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
            ['Billed quantity · kg', '1'],
            ['Final quantity · kg', '1'],
            ['Dyeing rolls', '1'],
            ['Dyeing rate / kg', '10'],
          ];
  if (pageKey === 'knitting') await pick(dialog, 'Knitter');
  for (const [key, value] of fields) {
    if (value === null) {
      if (pageKey === 'knitting' && key === 'Source yarn bill line') {
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
  await dialog.getByLabel('Dyer').selectOption({ index: 1 });
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
  const available = options
    .filter((label) => label.includes('BROWSER-'))
    .sort()
    .at(-1);
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
  const {
    rows: [row],
  } = await db.query(
    `select r.id, ${labelColumn} as name from garments_erp.${target.table} r
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
        ? page
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
    const card = page.locator('.overview-card').filter({
      has: page.getByRole('heading', { name, exact: true }),
    });
    await button(card, 'View/Edit →').click();
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
  for (const target of modalOnly || photoOnly ? [] : FILE_TARGETS) {
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
