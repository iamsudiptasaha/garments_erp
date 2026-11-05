import { readFileSync } from 'node:fs';
const migration = '20261105152128_employee_photo_attachment_and_checklist.sql';
// Overlay only the explicitly reviewed photo FK on the historic schema capture.
export function employeePhotoReleaseSchema(snapshot) {
  const sql = readFileSync(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8');
  if (!sql.includes('alter column employee_photo type bigint') ||
      !sql.includes('foreign key(employee_photo) references garments_erp.attachments(id) on delete set null'))
    throw Error('Employee photo migration differs from the reviewed attachment contract');
  const schema = structuredClone(snapshot);
  const column = schema.columns.find(c => c.table_schema === 'garments_erp' && c.table_name === 'employee' && c.column_name === 'employee_photo');
  if (!column) throw Error('Employee photo column is missing');
  column.data_type = 'bigint';
  column.pending_migration = migration;
  if (!schema.foreign_keys.some(f => f.schema === 'garments_erp' && f.table === 'employee' && f.definition.includes('FOREIGN KEY (employee_photo)')))
    schema.foreign_keys.push({schema:'garments_erp',table:'employee',name:'employee_photo_fkey',definition:'FOREIGN KEY (employee_photo) REFERENCES garments_erp.attachments(id) ON DELETE SET NULL'});
  return schema;
}
