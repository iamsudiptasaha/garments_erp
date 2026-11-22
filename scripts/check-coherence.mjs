import {productionReferenceSchema} from './production-reference-contract.mjs';
import {fabricBatchReleaseSchema,inspectFabricBatch} from './fabric-batch-contract.mjs';
import {employeePhotoReleaseSchema} from './employee-photo-contract.mjs';
import {contactReleaseSchema} from './contact-primary-contract.mjs';
import {readFileSync} from 'node:fs';
import {pages} from '../fabric-poc/src/fabric/catalog.js';
import {FILE_TARGETS} from '../fabric-poc/src/files/model.js';
import {checklistFields} from '../fabric-poc/src/production/item-model.js';
import {employeeRelations} from '../fabric-poc/src/hr/model.js';
import {checkBoundaries} from './coherence-boundaries.mjs';
function fabricPlannerReleaseSchema(schema) {
 const migration = '20261117100000_fabric_receipt_cost_and_sku.sql';
 const sql = readFileSync(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8');
 if (!sql.includes('add column series smallint unique check (series between 1 and 9)'))
  throw Error('Fabric Types requires a unique SKU series from 1 to 9');
 const plannerMigration = '20261122085000_fabric_subparts_and_statuses.sql';
 const plannerSql = readFileSync(new URL('../supabase/migrations/' + plannerMigration, import.meta.url), 'utf8');
 if (!plannerSql.includes('add column dyeing_program_status_id bigint references garments_erp.dyeing_program_status(id)'))
  throw Error('Dyeing Program status must select its linked database status');
 return {...schema, columns: [...schema.columns, {
  table_schema: 'garments_erp', table_name: 'dyeing_program', column_name: 'dyeing_program_status_id', data_type: 'bigint', is_nullable: 'YES', pending_migration: plannerMigration,
 }, {
  table_schema: 'garments_erp', table_name: 'fabric_type', column_name: 'series',
  data_type: 'smallint', is_nullable: 'YES', pending_migration: migration,
 }]};
}
function checkoutReleaseSchema(schema) {
 const migration = '20261108135000_checkout_variant.sql';
 const sql = readFileSync(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8');
 if (!sql.includes('add column variant_item_id bigint references garments_erp.variant_item (id)'))
  throw Error('Checkout variant must reference garments_erp.variant_item(id)');
 const receiptMigration = '20261104172129_align_erp_diagram_relationships.sql';
 const receiptSql = readFileSync(new URL('../supabase/migrations/' + receiptMigration, import.meta.url), 'utf8');
 if (!receiptSql.includes('add column raw_material_purchase_order_item_id bigint'))
  throw Error('Stock receipts require a purchase order line column');
 const categoryMigration = '20261109102000_item_costing_classification.sql';
 const categorySql = readFileSync(new URL('../supabase/migrations/' + categoryMigration, import.meta.url), 'utf8');
 if (!categorySql.includes('add column material_category_id bigint references garments_erp.category_list (id)'))
  throw Error('Receipt category must reference garments_erp.category_list(id)');
 if (!categorySql.includes('add column stage_id bigint references garments_erp.stage (id)'))
  throw Error('Checkout stage must reference garments_erp.stage(id)');
 return {...schema, columns: [...schema.columns, {
  table_schema: 'garments_erp', table_name: 'raw_material_check_in', column_name: 'raw_material_purchase_order_item_id',
  data_type: 'bigint', is_nullable: 'YES', pending_migration: receiptMigration,
 }, {
  table_schema: 'garments_erp', table_name: 'raw_material_check_in', column_name: 'material_category_id',
  data_type: 'bigint', is_nullable: 'YES', pending_migration: categoryMigration,
 }, {
  table_schema: 'garments_erp', table_name: 'raw_material_check_out', column_name: 'stage_id',
  data_type: 'bigint', is_nullable: 'YES', pending_migration: categoryMigration,
 }, {
  table_schema: 'garments_erp', table_name: 'raw_material_check_out', column_name: 'variant_item_id',
  data_type: 'bigint', is_nullable: 'YES', pending_migration: migration,
 }]};
}
export function inspect(schema, catalogue, screens=pages){
 const errors=[]; const tables=new Map();
 for(const c of schema.columns){const key=c.table_schema+'.'+c.table_name;if(!tables.has(key))tables.set(key,new Set());tables.get(key).add(c.column_name)}
 const field=(table,key,where)=>{if(!tables.get(table)?.has(key))errors.push(`${where}: missing database field ${table}.${key}`)};
 if(tables.has('garments_erp.employee'))for(const [table,fields] of Object.entries(employeeRelations)){
  for(const key of fields)field('garments_erp.'+table,key,'Employee / HR');
  if(!catalogue.mappings?.some(m=>m.resource_key==='employees'&&m.table_name===table&&m.can_edit))errors.push('Employee / HR: missing writable mapping for '+table);
 }
 for(const t of catalogue.tables)if(!tables.has(t.schema_name+'.'+t.table_name))errors.push(`Catalogue: missing database relation ${t.schema_name}.${t.table_name}`);
 for(const [screen,p] of Object.entries(screens)){
  if(!p.entity)continue;
  if(p.entity==='suppliers'){if(!(p.header||[]).some(f=>f.key==='contact_purpose_id'))errors.push('suppliers: required database contact_purpose_id is not captured by the supplier form');continue}
  const table='garments_erp.'+p.entity;
  if(!tables.has(table)){errors.push(`${screen}: missing database relation ${table}`);continue}
  for(const f of p.header||[])field(table,f.key,screen);
  if(['brand_list','yarn_type','fabric_type','color_map','color_map_by_brand'].includes(p.entity))for(const c of schema.columns.filter(c=>c.table_schema==='garments_erp'&&c.table_name===p.entity&&c.column_name!=='id'&&c.is_nullable==='NO'&&!c.column_default&&c.is_identity!=='YES'))if(!(p.header||[]).some(f=>f.key===c.column_name))errors.push(`${screen}: required database field ${table}.${c.column_name} has no form input or reviewed default`);
  if(p.identity)field(table,p.identity,screen);
  if(p.lines){const child='garments_erp.'+p.lines;field(child,p.foreign,screen);for(const f of [...(p.lineFields||[]),...(p.groupFields||[])]){if(f.storage){const destination='garments_erp.'+f.storage.table;field(destination,f.storage.key,screen);field(destination,f.storage.foreign,screen);if(!catalogue.mappings?.some(m=>m.resource_key===screen&&m.table_name===f.storage.table&&m.can_edit))errors.push(`${screen}: mapped input ${f.key} has no reviewed writable table mapping`);if(schema.foreign_keys&&!schema.foreign_keys.some(k=>k.schema==='garments_erp'&&k.table===f.storage.table&&k.definition.includes('FOREIGN KEY ('+f.storage.foreign+') REFERENCES '+child+'(id)')))errors.push(`${screen}: mapped input ${f.key} has no FK to ${child}`)}else field(child,f.key,screen)}}
 }
 if(screens.productionItems)for(const [key]of checklistFields)field('garments_erp.production_checklist',key,'Item checklist');
 if(schema.foreign_keys)for(const target of FILE_TARGETS){field('garments_erp.'+target.table,target.slot,'Upload route '+target.key);if(!schema.foreign_keys.some(f=>f.schema==='garments_erp'&&f.table===target.table&&f.definition.includes('FOREIGN KEY ('+target.slot+') REFERENCES garments_erp.attachments(id)')))errors.push('Upload route '+target.key+': source field must reference attachments(id)')}
 return [...new Set(errors)].sort();
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const captured=JSON.parse(readFileSync(new URL('../database/schema/live-schema.json',import.meta.url)));
 const schema=fabricPlannerReleaseSchema(checkoutReleaseSchema(productionReferenceSchema(fabricBatchReleaseSchema(employeePhotoReleaseSchema(contactReleaseSchema(captured))))));
 const catalogue=JSON.parse(readFileSync(new URL('../database/catalogue/screen-table-map.json',import.meta.url)));
 const errors=[...inspect(schema,catalogue),...inspectFabricBatch(schema)];
 try{console.log(checkBoundaries());}catch(e){errors.push(e.message)}
 console.log(`Database/UI coherence: ${schema.captured_at}; ${schema.columns.length} release columns checked (includes reviewed pending migrations).`);
 if(errors.length){console.error(errors.map(e=>'BLOCKED: '+e).join('\n'));process.exitCode=1}else console.log('No declared form/catalogue drift found. Workflow tests must also pass.');
}
