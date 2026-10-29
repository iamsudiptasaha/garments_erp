import { readFileSync, writeFileSync } from 'node:fs';
const catalogue = JSON.parse(readFileSync('database/catalogue/screen-table-map.json', 'utf8'));
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
let sql = `insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000001','admin@example.invalid'),('00000000-0000-4000-8000-000000000002','viewer@example.invalid');
insert into garments_erp.contacts(id,company_name) values (900001,'Synthetic CI administrator'),(900002,'Synthetic CI viewer');
insert into garments_erp.contact_purpose(id,type) values (900001,'CI fixture');
insert into garments_erp.employee(id,employee_code,contacts_id,contact_purpose_id) values (900001,'SCE/90001',900001,900001),(900002,'SCE/90002',900002,900001);
insert into garments_access.app_role(key,name,is_system_admin) values ('ci_admin','CI administrator',true),('ci_viewer','CI viewer',false);
insert into garments_access.app_user(user_id,employee_id,is_active) values ('00000000-0000-4000-8000-000000000001',900001,true),('00000000-0000-4000-8000-000000000002',900002,true);
insert into garments_access.app_user_role(user_id,role_id) select '00000000-0000-4000-8000-000000000001',id from garments_access.app_role where key='ci_admin';
insert into garments_access.app_user_role(user_id,role_id) select '00000000-0000-4000-8000-000000000002',id from garments_access.app_role where key='ci_viewer';\n`;
for (const r of catalogue.resources)
  sql += `insert into garments_access.app_resource(key,name,resource_type,route,sort_order,is_active,admin_only) values (${literal(r.key)},${literal(r.name)},${literal(r.resource_type)},${r.route ? literal(r.route) : 'null'},${r.sort_order},true,${r.admin_only});\n`;
for (const r of catalogue.resources.filter((r) => r.parent))
  sql += `update garments_access.app_resource set parent_resource_id=(select id from garments_access.app_resource where key=${literal(r.parent)}) where key=${literal(r.key)};\n`;
for (const t of catalogue.tables)
  sql += `insert into garments_access.app_db_table(schema_name,table_name) values (${literal(t.schema_name)},${literal(t.table_name)});\n`;
for (const m of catalogue.mappings)
  sql += `insert into garments_access.app_resource_table(app_resource_id,app_db_table_id,relation_type,can_view,can_create,can_edit,can_delete) select r.id,t.id,${literal(m.relation_type)},${m.can_view},${m.can_create},${m.can_edit},${m.can_delete} from garments_access.app_resource r,garments_access.app_db_table t where r.key=${literal(m.resource_key)} and t.schema_name=${literal(m.schema_name)} and t.table_name=${literal(m.table_name)};\n`;
sql += `insert into garments_access.app_role_resource_permission(app_role_id,app_resource_id,can_view) select role.id,r.id,true from garments_access.app_role role,garments_access.app_resource r where role.key='ci_viewer' and r.key='colours';\n`;
writeFileSync(process.argv[2] || '/tmp/erp-ci-seed.sql', sql);
