import { readFileSync, writeFileSync } from 'node:fs';
import { FILE_GROUPS, FILE_TARGETS } from '../../fabric-poc/src/files/model.js';
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
  sql += `insert into garments_access.app_db_table(schema_name,table_name) values (${literal(t.schema_name)},${literal(t.table_name)}) on conflict(schema_name,table_name) do nothing;\n`;
for (const m of catalogue.mappings)
  sql += `insert into garments_access.app_resource_table(app_resource_id,app_db_table_id,relation_type,can_view,can_create,can_edit,can_delete) select r.id,t.id,${literal(m.relation_type)},${m.can_view},${m.can_create},${m.can_edit},${m.can_delete} from garments_access.app_resource r,garments_access.app_db_table t where r.key=${literal(m.resource_key)} and t.schema_name=${literal(m.schema_name)} and t.table_name=${literal(m.table_name)};\n`;
sql += `insert into garments_access.app_role_resource_permission(app_role_id,app_resource_id,can_view) select role.id,r.id,true from garments_access.app_role role,garments_access.app_resource r where role.key='ci_viewer' and r.key='colours';\n`;
sql += `insert into auth.sessions(id,user_id,aal,created_at,updated_at) values ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','aal2',now(),now()),('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','aal2',now(),now());\n`;
// Synthetic verified factors for SQL-only fixture sessions; real Auth integration enrolls its own.
sql += `insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) select gen_random_uuid(),id,'SQL fixture','totp','verified',now(),now() from auth.users where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');\n`;
for (const group of FILE_GROUPS) {
  sql += `insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values (${literal(group.bucket)},${literal(group.bucket)},false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);\n`;
  sql += `insert into garments_erp.bucket_group(bucket_id,"group",description) values (${literal(group.bucket)},${literal(group.key)},${literal(group.description)});\n`;
}
for (const t of FILE_TARGETS)
  sql += `insert into garments_access.app_file_route(target_key,bucket_group_id,allowed_mime_types,max_bytes) select ${literal(t.key)},id,array[${t.mime.map(literal).join(',')}],10485760 from garments_erp.bucket_group where "group"=${literal(t.group)};\n`;
sql += `insert into garments_erp.knitter(id,contact_purpose_id,contacts_id) values (900001,900001,900001);\ninsert into garments_erp.knitting_bill(id,knitter_id,invoice_date,invoice_number) values (900001,900001,current_date,'CI-KNIT-ONLY');\ninsert into garments_erp.yarn_bill(id,invoice_date,invoice_number) values (900001,current_date,'CI-YARN-ONLY');\n`;
sql += `create or replace function public.ci_refuse_sms(event jsonb) returns jsonb language plpgsql set search_path='' as $$ begin raise exception 'SMS delivery is forbidden in isolated tests';end $$;\nrevoke all on function public.ci_refuse_sms(jsonb) from public,anon,authenticated;\ngrant execute on function public.ci_refuse_sms(jsonb) to supabase_auth_admin;\n`;
writeFileSync(process.argv[2] || '/tmp/erp-ci-seed.sql', sql);
