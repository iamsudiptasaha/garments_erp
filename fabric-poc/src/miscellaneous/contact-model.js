import { primaryFields, validateContactPrimaries } from './primary.js';
import { miscellaneousPages } from './catalog.js';
import { saveDocument } from '../fabric/domain.js';
export const contactSections = [
  { table: 'contact_items', resource: 'contactPeople', title: 'Contact items' },
  { table: 'contact_bank_account', resource: 'contactBankAccounts', title: 'Bank accounts' },
  { table: 'contact_extra', resource: 'contactDetails', title: 'Additional Details' },
].map((section) => ({
  ...section,
  foreign: 'contact_id',
  optional: true,
  fields: miscellaneousPages[section.resource].header.filter((f) => f.key !== 'contact_id'),
}));
export function contactDraft(data, id, can = () => true) {
  const contact = data.contacts.find((r) => r.id === id);
  return {
    header: contact
      ? { ...contact }
      : Object.fromEntries(miscellaneousPages.materialContacts.header.map((f) => [f.key, ''])),
    sections: Object.fromEntries(
      contactSections
        .filter((s) => can('view', s.resource))
        .map((s) => [
          s.table,
          data[s.table].filter((r) => r.contact_id === id).map((r) => ({ ...r })),
        ]),
    ),
  };
}
const populated = (row, fields) =>
  fields.some((f) =>
    f.type === 'checkbox'
      ? row[f.key] === true
      : row[f.key] != null && String(row[f.key]).trim() !== '',
  );
export function saveContact(data, draft, can = () => true) {
  if (data._live) throw Error('Contact document saving is not connected to the live database yet.');
  if (!can(draft.header.id ? 'edit' : 'create', 'materialContacts'))
    throw Error('Contact write permission required.');
  validateContactPrimaries(
    Object.fromEntries(
      Object.entries(draft.sections).map(([table, rows]) => [
        table,
        rows.map((row) => ({ ...row, contact_id: 'draft-contact' })),
      ]),
    ),
  );
  let next = saveDocument(data, 'materialContacts', { header: draft.header });
  const rootId =
    draft.header.id || next.contacts.find((r) => !data.contacts.some((old) => old.id === r.id)).id;
  for (const section of contactSections) {
    const rows = draft.sections[section.table];
    if (rows === undefined) continue;
    if (!can('view', section.resource)) throw Error('Contact section is no longer accessible.');
    const existing = data[section.table].filter((r) => r.contact_id === rootId);
    if (existing.some((old) => !rows.some((row) => row.id === old.id)))
      throw Error('Existing child records cannot be deleted from this form.');
    // Clear displaced primaries first in this private copy, so swapping two flags
    // cannot fail on a temporary duplicate. The workspace is saved only at the end.
    for (const old of existing) {
      const replacement = rows.find((row) => row.id === old.id);
      for (const key of primaryFields[section.table] || []) {
        if (old[key] === true && replacement?.[key] !== true) {
          if (!can('edit', section.resource))
            throw Error('You cannot change the previous primary.');
          next[section.table].find((row) => row.id === old.id)[key] = false;
        }
      }
    }
    for (const row of rows) {
      if (!row.id && !populated(row, section.fields)) continue;
      const old = row.id ? existing.find((r) => r.id === row.id) : null;
      if (row.id && !old) throw Error('A child record belongs to another contact.');
      if (row.contact_id && row.contact_id !== rootId)
        throw Error('A child record cannot move to another contact.');
      const values = Object.fromEntries(section.fields.map((f) => [f.key, row[f.key] ?? '']));
      if (
        old &&
        section.fields.every((f) => String(old[f.key] ?? '') === String(values[f.key] ?? ''))
      )
        continue;
      if (!can(old ? 'edit' : 'create', section.resource))
        throw Error('You cannot change ' + section.title.toLowerCase() + '.');
      next = saveDocument(next, section.resource, {
        header: { ...values, ...(old ? { id: old.id } : {}), contact_id: rootId },
      });
    }
  }
  return next;
}
