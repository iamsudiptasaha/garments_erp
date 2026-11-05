import {employeePhotoReleaseSchema} from './employee-photo-contract.mjs';
import {contactReleaseSchema} from './contact-primary-contract.mjs';
import {readFileSync} from 'node:fs';
import {pages} from '../fabric-poc/src/fabric/catalog.js';
import {FILE_TARGETS} from '../fabric-poc/src/files/model.js';
import {checklistFields} from '../fabric-poc/src/production/item-model.js';
import {employeeRelations} from '../fabric-poc/src/hr/model.js';
import {checkBoundaries} from './coherence-boundaries.mjs';
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
 const schema=employeePhotoReleaseSchema(contactReleaseSchema(JSON.parse(readFileSync(new URL('../database/schema/live-schema.json',import.meta.url)))));
 const catalogue=JSON.parse(readFileSync(new URL('../database/catalogue/screen-table-map.json',import.meta.url)));
 const errors=inspect(schema,catalogue);
 try{console.log(checkBoundaries());}catch(e){errors.push(e.message)}
 console.log(`Database/UI coherence: ${schema.captured_at}; ${schema.columns.length} release columns checked (includes reviewed pending migrations).`);
 if(errors.length){console.error(errors.map(e=>'BLOCKED: '+e).join('\n'));process.exitCode=1}else console.log('No declared form/catalogue drift found. Workflow tests must also pass.');
}
