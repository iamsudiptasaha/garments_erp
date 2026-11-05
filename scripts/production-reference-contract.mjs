import { readFileSync } from 'node:fs';
// The historic capture predates flags_list. Match the reviewed creation SQL,
// also verified against live metadata on 2026-11-05; never invent table aliases.
export function productionReferenceSchema(snapshot) {
  const sql = readFileSync(new URL('../supabase/migrations/20261105135706_production_hub_and_review_ownership.sql', import.meta.url), 'utf8');
  if (!sql.includes('create table garments_erp.flags_list (') || !sql.includes("name text not null unique check (name = btrim(name) and name <> '')"))
    throw Error('Flags schema differs from the reviewed reference contract');
  const schema = structuredClone(snapshot);
  for (const [name, type] of [['id','bigint'], ['name','text'], ['created_at','timestamp with time zone'], ['updated_at','timestamp with time zone']]) {
    if (!schema.columns.some(c => c.table_schema==='garments_erp' && c.table_name==='flags_list' && c.column_name===name))
      schema.columns.push({table_schema:'garments_erp',table_name:'flags_list',column_name:name,data_type:type,is_nullable:'NO',is_identity:name==='id'?'YES':'NO'});
  }
  return schema;
}
