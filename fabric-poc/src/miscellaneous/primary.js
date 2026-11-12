export const primaryFields = {
  contact_items: ['primary_address', 'primary_phone', 'primary_email'],
  contact_bank_account: ['primary_bank_account'],
};
export function validateContactPrimaries(data) {
  for (const [table, fields] of Object.entries(primaryFields))
    for (const key of fields) {
      const contacts = new Set();
      for (const row of data[table] || []) {
        if (row[key] !== true) continue;
        if (key === 'primary_email' && !String(row.email || '').trim())
          throw Error('Enter an email before selecting it as primary.');
        if (contacts.has(row.contact_id))
          throw Error('Only one ' + key.replaceAll('_', ' ') + ' is allowed per contact.');
        contacts.add(row.contact_id);
      }
    }
}
export function changeContactRow(rows, index, field, value) {
  return rows.map((row, i) =>
    i === index
      ? { ...row, [field.key]: value }
      : field.type === 'checkbox' && value === true
        ? { ...row, [field.key]: false }
        : row,
  );
}
