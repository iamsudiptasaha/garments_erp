import { readFileSync } from 'node:fs';
const migration = '20261122155813_transferable_materials.sql';
export function transferableReleaseSchema(schema) {
  const sql = readFileSync(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8');
  if (!sql.includes('add column is_transferable boolean not null default false'))
    throw Error('Transferable receipt flag must default false and be NOT NULL');
  const fields = {
    transferable_item_movement_type: { id: 'bigint', type: 'text' },
    transferable_item_movement: {
      id: 'bigint',
      raw_material_check_in_id: 'bigint',
      transferable_item_movement_type_id: 'bigint',
      job_worker_id: 'bigint',
      item_id: 'bigint',
      employee_id: 'bigint',
      movement_at: 'timestamp with time zone',
      remarks: 'text',
    },
    raw_material_check_in: { is_transferable: 'boolean' },
  };
  const references = {
    raw_material_check_in_id: 'raw_material_check_in',
    transferable_item_movement_type_id: 'transferable_item_movement_type',
    job_worker_id: 'job_worker',
    item_id: 'item',
    employee_id: 'employee',
  };
  for (const [column, table] of Object.entries(references)) {
    if (
      !new RegExp(
        `${column} bigint(?: not null)? references garments_erp\\.${table}\\(id\\) on delete restrict`,
      ).test(sql)
    )
      throw Error('Movement FK ownership differs: ' + column);
  }
  if (!sql.includes('movement_at timestamptz not null'))
    throw Error('Movement time must be timestamptz');
  return {
    ...schema,
    columns: [
      ...schema.columns,
      ...Object.entries(fields).flatMap(([table, columns]) =>
        Object.entries(columns).map(([column, type]) => ({
          table_schema: 'garments_erp',
          table_name: table,
          column_name: column,
          data_type: type,
          is_nullable: ['job_worker_id', 'item_id', 'remarks'].includes(column) ? 'YES' : 'NO',
          pending_migration: migration,
        })),
      ),
    ],
    foreign_keys: [
      ...schema.foreign_keys,
      ...Object.entries(references).map(([column, table]) => ({
        schema: 'garments_erp',
        table: 'transferable_item_movement',
        definition: `FOREIGN KEY (${column}) REFERENCES garments_erp.${table}(id)`,
      })),
    ],
  };
}
