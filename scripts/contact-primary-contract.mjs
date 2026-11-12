import {readFileSync} from 'node:fs';
const contract=JSON.parse(readFileSync(new URL('../database/contracts/contact-primary.json',import.meta.url),'utf8'));
const migration=readFileSync(new URL('../supabase/migrations/'+contract.migration,import.meta.url),'utf8');
const emailMigration=readFileSync(new URL('../supabase/migrations/'+contract.emailMigration,import.meta.url),'utf8');
// Keep the captured live metadata unchanged. Add only reviewed, migration-backed
// columns to the expected release schema until the next live metadata capture.
export function contactReleaseSchema(snapshot,sql=migration){
 const schema=structuredClone(snapshot),normalized=sql.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').toLowerCase();
 for(const flag of contract.flags){
  if(!normalized.includes(`alter table garments_erp.${flag.table} add column ${flag.column} boolean not null default false;`)||!normalized.includes(`create unique index ${flag.index} on garments_erp.${flag.table} (contact_id) where ${flag.column};`))throw Error('Contact primary migration differs from reviewed column/unique-index contract: '+flag.column);
  const column=schema.columns.find(c=>c.table_schema==='garments_erp'&&c.table_name===flag.table&&c.column_name===flag.column);
  if(column){if(column.data_type!=='boolean'||column.is_nullable!=='NO'||column.column_default!=='false')throw Error('Live contact primary column differs from release contract: '+flag.column);}
  else schema.columns.push({table_schema:'garments_erp',table_name:flag.table,column_name:flag.column,data_type:'boolean',is_nullable:'NO',column_default:'false',pending_migration:contract.migration});
 }
 const emailSql=emailMigration.replace(/\s+/g,' ').toLowerCase();
 if(!emailSql.includes('alter table garments_erp.contact_items add column email text;') ||
    !emailSql.includes('alter table garments_erp.contact_items add column primary_email boolean not null default false;') ||
    !emailSql.includes('create unique index contact_items_one_primary_email on garments_erp.contact_items(contact_id) where primary_email;'))
  throw Error('Contact email migration differs from the reviewed columns or primary uniqueness contract.');
 for(const [name,type,nullable,defaultValue] of [['email','text','YES',null],['primary_email','boolean','NO','false']]){
  const existing=schema.columns.find(c=>c.table_schema==='garments_erp'&&c.table_name==='contact_items'&&c.column_name===name);
  if(existing){
   if(existing.data_type!==type||existing.is_nullable!==nullable||existing.column_default!==defaultValue)
    throw Error('Live contact email field differs from release contract: '+name);
  }else schema.columns.push({table_schema:'garments_erp',table_name:'contact_items',column_name:name,data_type:type,is_nullable:nullable,column_default:defaultValue,pending_migration:contract.emailMigration});
 }
 return schema;
}
