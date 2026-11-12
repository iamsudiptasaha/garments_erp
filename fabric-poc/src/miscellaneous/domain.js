import { validateContactPrimaries } from './primary.js';
export function initialMiscellaneous() {
  return {
    contact_items: [],
    contact_extra: [],
    contact_bank_account: [],
    bank_account_type: [
      { id: 'bank-type-current', name: 'Current' },
      { id: 'bank-type-savings', name: 'Savings' },
    ],
    attachments: [],
  };
}
export function upgradeMiscellaneous(data) {
  return { ...initialMiscellaneous(), ...data };
}
const dash = (value) => (value == null || value === '' ? '—' : value);
export function miscellaneousRows(data, page) {
  const identity = (row) => ({ id: row.id, documentId: row.id });
  const company = (id) => data.contacts.find((r) => r.id === id)?.company_name || '—';
  if (page === 'materialContacts')
    return data.contacts.map((r) => ({
      ...identity(r),
      name: r.company_name,
      gst: dash(r.gst),
      alias: dash(r.search_term),
      people: data.contact_items.filter((p) => p.contact_id === r.id).length,
      details: data.contact_extra.filter((p) => p.contact_id === r.id).length,
    }));
  if (page === 'contactPeople')
    return data.contact_items.map((r) => ({
      ...identity(r),
      name: r.name,
      company: company(r.contact_id),
      phone: dash(r.phone),
      address: dash(r.address),
      email: dash(r.email),
      primary_address: r.primary_address ? 'Yes' : 'No',
      primary_phone: r.primary_phone ? 'Yes' : 'No',
      primary_email: r.primary_email ? 'Yes' : 'No',
    }));
  if (page === 'contactDetails')
    return data.contact_extra.map((r) => ({
      ...identity(r),
      name: r.key,
      company: company(r.contact_id),
      value: dash(r.value),
    }));
  if (page === 'contactBankAccounts')
    return data.contact_bank_account.map((r) => ({
      ...identity(r),
      name: r.name,
      company: company(r.contact_id),
      holder: dash(r.account_holder_name),
      number: dash(r.account_number),
      branch: dash(r.branch),
      ifsc: dash(r.ifsc_code),
      type: data.bank_account_type.find((t) => t.id === r.bank_account_type_id)?.name || '—',
      address: dash(r.address),
      document: dash(r.supporting_documents),
      primary_bank_account: r.primary_bank_account ? 'Yes' : 'No',
    }));
  if (page === 'contactCategories')
    return data.contact_purpose.map((r) => ({
      ...identity(r),
      name: r.type,
      uses: ['raw_material_supplier_list', 'yarn_supplier', 'knitter', 'dyer', 'employee'].reduce(
        (n, table) =>
          n +
          (data[table] || []).filter(
            (x) => x.contact_purpose_id === r.id || x.contact_purpose_emergency_id === r.id,
          ).length,
        0,
      ),
    }));
  if (page === 'bankAccountTypes')
    return data.bank_account_type.map((r) => ({ ...identity(r), name: r.name }));
  return [];
}
export function miscellaneousOptions(data, source) {
  if (source === 'bankAccountTypes') return data.bank_account_type.map((r) => [r.id, r.name]);
  if (source === 'contactAttachments')
    return data.attachments.map((r) => [r.id, `Attachment ${r.id}`]);
  return null;
}
export function validateMiscellaneous(data) {
  validateContactPrimaries(data);
  for (const table of ['contact_items', 'contact_extra', 'contact_bank_account'])
    for (const r of data[table])
      if (!data.contacts.some((c) => c.id === r.contact_id))
        throw Error('Choose an existing company / contact.');
  for (const r of data.contact_bank_account) {
    if (
      r.bank_account_type_id &&
      !data.bank_account_type.some((t) => t.id === r.bank_account_type_id)
    )
      throw Error('The selected bank account type no longer exists.');
    if (r.supporting_documents && !data.attachments.some((a) => a.id === r.supporting_documents))
      throw Error('The selected supporting document no longer exists.');
  }
  const details = new Set();
  for (const r of data.contact_extra) {
    const key = r.contact_id + '|' + r.key.trim().toLowerCase();
    if (details.has(key))
      throw Error('This detail already exists for that contact. Edit the existing detail.');
    details.add(key);
  }
  const accounts = new Set();
  for (const r of data.contact_bank_account) {
    if (!r.account_number) continue;
    const key = r.contact_id + '|' + r.account_number.replaceAll(' ', '');
    if (accounts.has(key))
      throw Error(
        'This account number already exists for that contact. Edit the existing bank account.',
      );
    accounts.add(key);
  }
  return true;
}
