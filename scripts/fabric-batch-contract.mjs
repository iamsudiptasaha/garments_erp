import { readFileSync } from 'node:fs';
import { fabricColumnTypes } from '../fabric-poc/src/fabric/live-contract.js';
// The historic capture predates the deployed 5 November mapping-ID migration.
export function fabricBatchReleaseSchema(snapshot) {
  const sql = readFileSync(new URL('../supabase/migrations/20261105135706_production_hub_and_review_ownership.sql', import.meta.url), 'utf8');
  if (!sql.includes('foreign key(batch_no) references garments_erp.batch_no_lab_dip_version_map(id)')) throw Error('Previous batch must reference the batch mapping ID');
  const schema = structuredClone(snapshot);
  const column = schema.columns.find((c) => c.table_schema === 'garments_erp' && c.table_name === 'dyeing_program_item' && c.column_name === 'batch_no');
  if (!column) throw Error('Previous batch column is missing');
  column.data_type = 'bigint';
  schema.foreign_keys = schema.foreign_keys.filter((f) => !(f.schema === 'garments_erp' && f.table === 'dyeing_program_item' && f.definition.includes('FOREIGN KEY (batch_no)')));
  schema.foreign_keys.push({ schema: 'garments_erp', table: 'dyeing_program_item', definition: 'FOREIGN KEY (batch_no) REFERENCES garments_erp.batch_no_lab_dip_version_map(id)' });
  schema.columns.push({table_schema:'garments_erp',table_name:'dyeing_program_lab_dip',column_name:'batch_no',data_type:'bigint',is_nullable:'YES'});
  schema.foreign_keys.push({schema:'garments_erp',table:'dyeing_program_lab_dip',definition:'FOREIGN KEY (batch_no) REFERENCES garments_erp.batch_no_lab_dip_version_map(id)'});
  return schema;
}
export function inspectFabricBatch(schema, types = fabricColumnTypes) {
 const sql = readFileSync(new URL('../supabase/migrations/20261123200917_lab_dip_edition_groups.sql',import.meta.url),'utf8');
 return schema.columns.some(c=>c.table_name==='dyeing_program_lab_dip'&&c.column_name==='batch_no'&&c.data_type==='bigint') && schema.foreign_keys.some(f=>f.table==='dyeing_program_lab_dip'&&f.definition.includes('FOREIGN KEY (batch_no) REFERENCES garments_erp.batch_no_lab_dip_version_map(id)')) && types.dyeing_program_lab_dip?.batch_no === 'bigint' && sql.includes('batch_no bigint references garments_erp.batch_no_lab_dip_version_map(id)') && sql.includes('drop column lab_dip_version_id,drop column batch_no') ? [] : ['Fabric: group previous batch must select a bigint batch-mapping ID'];
}
