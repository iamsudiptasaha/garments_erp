-- Employee photos are private attachments; checklist follows the revised ER.
begin;

-- Preserve only unambiguous existing image references in the employee bucket.
-- Unresolvable legacy links become NULL; attachment objects are never deleted.
create temporary table employee_photo_map on commit drop as
select e.id, case when count(distinct a.id)=1 then min(a.id) end as attachment_id
from garments_erp.employee e
left join garments_erp.attachments a on
 (e.employee_photo=a.id::text or e.employee_photo=a.storage_path or e.employee_photo=a.address)
 and a.mime_type in ('image/jpeg','image/png','image/webp')
 and a.bucket_group_id in (select id from garments_erp.bucket_group where "group"='employee')
group by e.id;
update garments_erp.employee e set employee_photo=m.attachment_id::text
from employee_photo_map m where m.id=e.id and e.employee_photo is distinct from m.attachment_id::text;
alter table garments_erp.employee alter column employee_photo type bigint using employee_photo::bigint;
alter table garments_erp.employee add constraint employee_photo_fkey
 foreign key(employee_photo) references garments_erp.attachments(id) on delete set null;
create index employee_photo_idx on garments_erp.employee(employee_photo) where employee_photo is not null;
alter table garments_erp.production_checklist drop column tna_acquired_status_id;

create or replace function garments_access.file_target_definition(p_key text) returns jsonb language plpgsql immutable set search_path='' as $$
declare t jsonb;
begin
 select value into t from jsonb_array_elements('[
 {"key":"yarnBill","group":"fabric_bills","resource":"yarn","table":"yarn_bill","slot":"bill_attachment","label":"invoice_number"},
 {"key":"knittingBill","group":"fabric_bills","resource":"knitting","table":"knitting_bill","slot":"bill_attachment","label":"invoice_number"},
 {"key":"dyedBill","group":"fabric_bills","resource":"dyeBills","table":"dyed_fabric_bill","slot":"bill_attachment","label":"invoice_number"},
 {"key":"workerBill","group":"job_worker_bills","resource":"jobWorkerBills","table":"job_worker_bill","slot":"bill_attachment","label":"id"},
 {"key":"itemImage","group":"items","resource":"productionItems","table":"item","slot":"image_attachment","label":"style_code"},
 {"key":"rawMaterialBill","group":"raw_material_bills","resource":"materialReceipts","table":"raw_material_check_in","slot":"bill_attachment","label":"sku"},
 {"key":"employeePhoto","group":"employee","resource":"employees","table":"employee","slot":"employee_photo","label":"employee_code"},
 {"key":"employeeDocument1","group":"employee","resource":"employees","table":"employee","slot":"supporting_document_1_upload","label":"employee_code"},
 {"key":"employeeDocument2","group":"employee","resource":"employees","table":"employee","slot":"supporting_document_2_upload","label":"employee_code"},
 {"key":"labDipShade","group":"items","resource":"labDips","table":"lab_dip_version","slot":"shade_card_image_attachment","label":"id"}
 ]'::jsonb) where value->>'key'=p_key;
 if t is null then raise exception 'Attachment field is not configured';end if;return t;
end $$;
insert into garments_access.app_file_route(target_key,bucket_group_id,allowed_mime_types,max_bytes)
select 'employeePhoto',id,array['image/jpeg','image/png','image/webp'],10485760
from garments_erp.bucket_group where "group"='employee';

-- The profile RPC cannot assign attachment IDs. Only the guarded file route can.
create or replace function garments_access.save_employee(p_payload jsonb,p_proof uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare eid bigint:=nullif(p_payload->>'id','')::bigint; v bigint; row garments_erp.employee; proof garments_access.employee_attestation; d jsonb:=p_payload->'draft'; expected text:=p_payload->>'expected'; action text:=case when eid is null then 'create' else 'edit' end; e garments_erp.employee;
begin
 if not garments_access.has_screen_permission('employees',action) then raise exception 'Employee write access required' using errcode='42501';end if;
 if pg_column_size(p_payload)>100000 or jsonb_typeof(d)<>'object' then raise exception 'Invalid employee document';end if;
 if exists(select 1 from jsonb_object_keys(d) k where k<>'employee') or jsonb_typeof(d->'employee')<>'object'
 or exists(select 1 from jsonb_object_keys(d->'employee') k where not k=any(array['contacts_id','contact_purpose_id','contacts_emergency_id','contact_purpose_emergency_id','date_of_joining','date_of_birth','gender_id','blood_group_id','type_of_employment_id','supporting_document_1_title','supporting_document_2_title'])) then raise exception 'Unsupported employee field';end if;
 if nullif(d->'employee'->>'contacts_id','') is null or nullif(d->'employee'->>'contact_purpose_id','') is null then raise exception 'Select employee contact and purpose';end if;
 if nullif(d->'employee'->>'contact_purpose_emergency_id','') is not null and nullif(d->'employee'->>'contacts_emergency_id','') is null then raise exception 'Select an emergency contact before its purpose';end if;
 if eid is not null then
  select * into row from garments_erp.employee where id=eid for update;
  if not found then raise exception 'Employee no longer exists';end if;
  if md5(garments_access.employee_document(eid)::text) is distinct from expected then raise exception 'Employee changed. Reload before saving.' using errcode='40001';end if;
 end if;
 select employee_id into v from garments_access.app_user where user_id=auth.uid();
 if v is null then raise exception 'An operator employee link is required' using errcode='42501';end if;
 select * into e from jsonb_populate_record(null::garments_erp.employee,(select jsonb_object_agg(k,case when val='""'::jsonb then 'null'::jsonb else val end) from jsonb_each(d->'employee') x(k,val)));
 if e.date_of_birth>current_date then raise exception 'Date of birth cannot be in the future';end if;
 if eid is null then
  insert into garments_erp.employee(contacts_id,contact_purpose_id) values(e.contacts_id,e.contact_purpose_id) returning id into eid;
 end if;
 update garments_erp.employee set contacts_id=e.contacts_id,contact_purpose_id=e.contact_purpose_id,contacts_emergency_id=e.contacts_emergency_id,contact_purpose_emergency_id=e.contact_purpose_emergency_id,
 date_of_joining=e.date_of_joining,date_of_birth=e.date_of_birth,gender_id=e.gender_id,blood_group_id=e.blood_group_id,type_of_employment_id=e.type_of_employment_id,
 supporting_document_1_title=e.supporting_document_1_title,supporting_document_2_title=e.supporting_document_2_title,verified_by_employee_id=v,is_verified=true where id=eid;


 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'Saved employee','employee',eid::text,jsonb_build_object('verified_by_employee_id',v::text));
 return garments_access.employee_snapshot();
end $$;

commit;
