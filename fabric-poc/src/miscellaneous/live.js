import { liveFileCommands } from '../files/live.js';
import { resolveGroup, validateFile } from '../files/model.js';
import { contactSections } from './contact-model.js';
import { miscellaneousPages } from './catalog.js';
import { validateContactPrimaries } from './primary.js';

const present = (value) => value != null && String(value).trim() !== '';
const revision = ({ id, updated_at }) => ({ id, updated_at });
const deletion = (row) => ({ ...revision(row), remove: true });
const inputValues = (row, fields) =>
  Object.fromEntries(
    fields.map(({ key, type }) => [
      key,
      type === 'checkbox' ? row[key] === true : (row[key] ?? null),
    ]),
  );

export function contactWrite(data, draft, remove = false) {
  const { header, sections } = draft;
  if (!remove && !present(header.company_name)) throw Error('Enter a company / contact name.');
  const document = {
    header: remove
      ? deletion(header)
      : { ...revision(header), ...inputValues(header, miscellaneousPages.materialContacts.header) },
    sections: {},
  };
  if (!remove)
    validateContactPrimaries(
      Object.fromEntries(
        Object.entries(sections).map(([table, rows]) => [
          table,
          rows.map((row) => ({ ...row, contact_id: header.id })),
        ]),
      ),
    );
  for (const section of contactSections) {
    const rows = sections[section.table];
    if (!rows) continue;
    const originals = header.id
      ? data[section.table].filter((row) => row.contact_id === header.id)
      : [];
    const changes = originals
      .filter((row) => remove || !rows.some(({ id }) => id === row.id))
      .map(deletion);
    if (!remove) {
      const fields = section.fields.filter(({ key }) => key !== 'supporting_documents');
      for (const row of rows) {
        if (
          !row.id &&
          !row.pendingFile &&
          !fields.some(({ key, type }) =>
            type === 'checkbox' ? row[key] === true : present(row[key]),
          )
        )
          continue;
        if (fields.some(({ key, required }) => required !== false && !present(row[key])))
          throw Error('Enter a detail name.');
        const values = inputValues(row, fields);
        const old = originals.find(({ id }) => id === row.id);
        if (!old || fields.some(({ key }) => String(values[key] ?? '') !== String(old[key] ?? '')))
          changes.push({
            ...revision(row),
            ...values,
            ...(row.pendingFile && !row.id ? { client_ref: row.pendingFile.requestId } : {}),
          });
      }
    }
    if (changes.length) document.sections[section.table] = changes;
  }
  return document;
}

export function contactsCommands(client) {
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw Error(error.message);
    return data;
  }
  return {
    load: () => rpc('erp_contacts_workspace'),
    save: (document) => rpc('erp_save_contact_workspace', { p_document: document }),
  };
}

export async function reviewContactBankFiles(client, files) {
  const commands = liveFileCommands(client);
  const targetKey = 'contactBankDocument';
  const [registry, routes] = await Promise.all([commands.registry(), commands.routes()]);
  const target = routes.find((route) => route.key === targetKey);
  if (!target || target.enabled === false) throw Error('Bank document uploads are disabled.');
  const group = resolveGroup(registry, target.group);
  for (const { file } of files)
    validateFile(file, target, {
      ...group,
      max_bytes: Math.min(group.max_bytes, target.max_bytes || 10485760),
    });
  const store = commands.store(registry, routes);
  return (entry) => store.attach({ ...entry, targetKey });
}
