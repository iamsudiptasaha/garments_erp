import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFabric } from '../src/fabric/domain.js';
import { contactDraft, saveContact } from '../src/miscellaneous/contact-model.js';
test('all contact child collections are optional and empty rows do not create placeholder records', () => {
  const data = initialFabric(),
    draft = contactDraft(data);
  draft.header.company_name = 'Synthetic contact';
  draft.sections.contact_items.push({ name: '', phone: '', address: '' });
  const next = saveContact(data, draft);
  assert.equal(next.contacts.length, data.contacts.length + 1);
  for (const table of ['contact_items', 'contact_bank_account', 'contact_extra'])
    assert.deepEqual(next[table], data[table]);
});
test('contact document assigns every child to its one root and is atomic on invalid extra data', () => {
  const data = initialFabric(),
    draft = contactDraft(data);
  draft.header.company_name = 'Synthetic contact';
  draft.sections.contact_items = [{ phone: '001234', name: '', address: '' }];
  draft.sections.contact_bank_account = [
    {
      account_number: '000123',
      bank_account_type_id: 'bank-type-savings',
      supporting_documents: '',
    },
  ];
  draft.sections.contact_extra = [{ key: 'Note', value: '' }];
  const next = saveContact(data, draft),
    root = next.contacts.find((r) => r.company_name === 'Synthetic contact');
  for (const table of ['contact_items', 'contact_bank_account', 'contact_extra'])
    assert.equal(next[table][0].contact_id, root.id);
  assert.equal(next.contact_bank_account[0].account_number, '000123');
  assert.equal(next.contact_extra[0].value, '');
  assert.equal(data.contact_items.length, 0);
  draft.sections.contact_extra = [{ key: '', value: 'invalid' }];
  assert.throws(() => saveContact(data, draft));
  assert.equal(data.contacts.length, next.contacts.length - 1);
});
test('editing Contacts retains children, timestamps and unrelated contact records', () => {
  let data = initialFabric();
  const initial = contactDraft(data, 's1');
  initial.sections.contact_items = [{ name: 'Synthetic item', phone: '000' }];
  data = saveContact(data, initial);
  const draft = contactDraft(data, 's1');
  draft.sections.contact_items[0].phone = '001';
  const next = saveContact(data, draft);
  assert.equal(next.contact_items[0].id, data.contact_items[0].id);
  assert.equal(next.contact_items[0].phone, '001');
  assert.deepEqual(
    next.contacts.find((c) => c.id === 's2'),
    data.contacts.find((c) => c.id === 's2'),
  );
  draft.sections.contact_items[0].contact_id = 's2';
  assert.throws(() => saveContact(data, draft), /another contact/);
});
test('bank data stays hidden and preserved when its separate page permission is absent', () => {
  const data = initialFabric();
  data.contact_bank_account.push({ id: 'bank', contact_id: 's1', account_number: '0001' });
  const can = (_action, resource) => resource !== 'contactBankAccounts';
  const draft = contactDraft(data, 's1', can);
  assert.equal(draft.sections.contact_bank_account, undefined);
  draft.header.search_term = 'Alias';
  const next = saveContact(data, draft, can);
  assert.deepEqual(next.contact_bank_account, data.contact_bank_account);
});

test('each contact has independent primary address, phone and bank account choices', () => {
  const data = initialFabric(),
    draft = contactDraft(data);
  draft.header.company_name = 'Synthetic primary contact';
  draft.sections.contact_items = [
    { address: 'A', primary_address: true, phone: '001' },
    { address: 'B', phone: '002', primary_phone: true },
  ];
  draft.sections.contact_bank_account = [
    { account_number: '001', primary_bank_account: true },
    { account_number: '002' },
  ];
  const next = saveContact(data, draft);
  assert.equal(next.contact_items[0].primary_address, true);
  assert.equal(next.contact_items[0].primary_phone, false);
  assert.equal(next.contact_items[1].primary_phone, true);
  assert.equal(next.contact_bank_account[0].primary_bank_account, true);
  draft.sections.contact_items[1].primary_address = true;
  assert.throws(() => saveContact(data, draft), /Only one primary address/);
  draft.sections.contact_items[1].primary_address = false;
  draft.sections.contact_bank_account[1].primary_bank_account = true;
  assert.throws(() => saveContact(data, draft), /Only one primary bank account/);
});

test('primary swaps save atomically and false defaults do not populate an empty row', () => {
  let data = initialFabric(),
    draft = contactDraft(data, 's1');
  draft.sections.contact_items = [
    { address: 'A', phone: '01', primary_address: true },
    { address: 'B', phone: '02', primary_phone: true },
  ];
  data = saveContact(data, draft);
  draft = contactDraft(data, 's1');
  draft.sections.contact_items[0].primary_address = false;
  draft.sections.contact_items[0].primary_phone = true;
  draft.sections.contact_items[1].primary_phone = false;
  draft.sections.contact_items[1].primary_address = true;
  const next = saveContact(data, draft);
  assert.equal(next.contact_items[0].primary_phone, true);
  assert.equal(next.contact_items[1].primary_address, true);
  assert.equal(data.contact_items[0].primary_address, true);
  const blank = contactDraft(data);
  blank.header.company_name = 'Synthetic empty defaults';
  blank.sections.contact_items = [{ primary_address: false, primary_phone: false }];
  blank.sections.contact_bank_account = [{ primary_bank_account: false }];
  assert.equal(saveContact(data, blank).contact_items.length, data.contact_items.length);
});
