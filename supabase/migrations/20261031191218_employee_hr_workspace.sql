-- Reviewed release only. Apply through the GitHub database deployment workflow.
begin;
create or replace function garments_erp.generate_employee_code() returns trigger
language plpgsql security invoker set search_path='' as $$
declare number bigint;
begin
 if new.employee_code is null or btrim(new.employee_code)='' then
  loop
   number:=nextval('garments_erp.employee_code_seq'::regclass);
   if number>99999 then raise exception 'Employee code capacity exceeded: SCE/99999';end if;
   new.employee_code:='SCE/'||lpad(number::text,5,'0');
   exit when not exists(select 1 from garments_erp.employee e where regexp_replace(e.employee_code,'[^0-9]','','g')=lpad(number::text,5,'0'));
  end loop;
 end if;
 return new;
end $$;
-- Contacts and their children are reference data here, never Employee-owned writes.
update garments_access.app_resource_table m set relation_type='lookup',can_create=false,can_edit=false,can_delete=false
from garments_access.app_resource r,garments_access.app_db_table t
where m.app_resource_id=r.id and m.app_db_table_id=t.id and r.key='employees' and t.schema_name='garments_erp' and t.table_name in ('contacts','contact_purpose');
-- Existing HR reference-list maintenance remains explicitly scoped.
update garments_access.app_resource_table m set relation_type='detail',can_create=true,can_edit=true
from garments_access.app_resource r,garments_access.app_db_table t
where m.app_resource_id=r.id and m.app_db_table_id=t.id and r.key='employees' and t.table_name in ('gender','blood_group','type_of_employment');
create table garments_access.employee_attestation (
 id uuid primary key default gen_random_uuid(), actor uuid not null references auth.users(id),
 verifier uuid not null references auth.users(id), employee_id bigint not null references garments_erp.employee(id),
 payload_hash text not null, expires_at timestamptz not null default now()+interval '2 minutes',
 used_at timestamptz, created_at timestamptz not null default now()
);
alter table garments_access.employee_attestation enable row level security;
create index on garments_access.employee_attestation(expires_at);
revoke all on garments_access.employee_attestation from public,anon,authenticated;
create function garments_access.invalidate_employee_verification() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (to_jsonb(new)-array['verified_by_employee_id','updated_at']) is distinct from (to_jsonb(old)-array['verified_by_employee_id','updated_at']) then new.verified_by_employee_id:=null;end if;
 return new;
end $$;
revoke all on function garments_access.invalidate_employee_verification() from public,anon,authenticated;
create trigger invalidate_employee_verification before update on garments_erp.employee for each row execute function garments_access.invalidate_employee_verification();

create function garments_access.employee_document(p_id bigint) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'employee',garments_access.fabric_json('employee',to_jsonb(e)),
 'contact',jsonb_build_object('id',c.id::text,'company_name',c.company_name),
 'contacts',(select coalesce(jsonb_agg(garments_access.fabric_json('contact_items',to_jsonb(x)) order by x.id),'[]') from garments_erp.contact_items x where x.contact_id=e.contacts_id),
 'emergency',(select jsonb_build_object('id',x.id::text,'company_name',x.company_name) from garments_erp.contacts x where x.id=e.contacts_emergency_id),
 'verifier_name',(select x.company_name from garments_erp.employee v join garments_erp.contacts x on x.id=v.contacts_id where v.id=e.verified_by_employee_id))
 from garments_erp.employee e join garments_erp.contacts c on c.id=e.contacts_id where e.id=p_id;
$$;
revoke all on function garments_access.employee_document(bigint) from public,anon,authenticated;

create function garments_access.employee_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; t text; rows jsonb;
begin
 if not garments_access.has_screen_permission('employees','view') then raise exception 'Employee access required' using errcode='42501';end if;
 result:=jsonb_build_object('records',(select coalesce(jsonb_agg(garments_access.employee_document(e.id)||jsonb_build_object('revision',md5(garments_access.employee_document(e.id)::text)) order by e.id),'[]') from garments_erp.employee e),
 'contact_choices',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id::text,'company_name',c.company_name) order by c.id),'[]') from garments_erp.contacts c),
 'verifiers',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'name',c.company_name,'code',e.employee_code,'email',a.email)),'[]') from garments_erp.employee e join garments_access.app_user u on u.employee_id=e.id and u.is_active and not u.must_change_password join auth.users a on a.id=u.user_id join garments_erp.contacts c on c.id=e.contacts_id where a.email is not null));
 foreach t in array array['gender','blood_group','type_of_employment','contact_purpose'] loop
  execute format('select coalesce(jsonb_agg(garments_access.fabric_json(%L,to_jsonb(x)) order by x.id),''[]''::jsonb) from garments_erp.%I x',t,t) into rows;
  result:=result||jsonb_build_object(t,rows);
 end loop;
 return result;
end $$;
revoke all on function garments_access.employee_snapshot() from public,anon;
grant execute on function garments_access.employee_snapshot() to authenticated;
create function public.erp_employee_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$ select garments_access.employee_snapshot(); $$;
revoke all on function public.erp_employee_snapshot() from public,anon;
grant execute on function public.erp_employee_snapshot() to authenticated;

-- A verifier's isolated password session authorises only this exact document and operator.
create function garments_access.employee_attest(p_actor uuid,p_employee bigint,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now()))
 or not exists(select 1 from jsonb_array_elements(auth.jwt()->'amr') a where a->>'method'='password' and (a->>'timestamp')::numeric between extract(epoch from now())-90 and extract(epoch from now())+5)
 or not exists(select 1 from garments_access.app_user where user_id=auth.uid() and employee_id=p_employee and is_active and not must_change_password)
 or not exists(select 1 from garments_access.app_user where user_id=p_actor and is_active and not must_change_password)
 then raise exception 'The selected employee must verify their own password again' using errcode='42501';end if;
 if pg_column_size(p_payload)>100000 then raise exception 'Employee record is too large';end if;
 delete from garments_access.employee_attestation where expires_at<now()-interval '1 day';
 insert into garments_access.employee_attestation(actor,verifier,employee_id,payload_hash) values(p_actor,auth.uid(),p_employee,encode(extensions.digest(p_payload::text,'sha256'),'hex')) returning id into result;
 return result;
end $$;
revoke all on function garments_access.employee_attest(uuid,bigint,jsonb) from public,anon;
grant execute on function garments_access.employee_attest(uuid,bigint,jsonb) to authenticated;
create function public.erp_employee_attestation(p_actor uuid,p_employee bigint,p_payload jsonb) returns uuid language sql security invoker set search_path='' as $$ select garments_access.employee_attest(p_actor,p_employee,p_payload); $$;
revoke all on function public.erp_employee_attestation(uuid,bigint,jsonb) from public,anon;
grant execute on function public.erp_employee_attestation(uuid,bigint,jsonb) to authenticated;

create function garments_access.save_employee(p_payload jsonb,p_proof uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare eid bigint:=nullif(p_payload->>'id','')::bigint; v bigint; row garments_erp.employee; proof garments_access.employee_attestation; d jsonb:=p_payload->'draft'; expected text:=p_payload->>'expected'; action text:=case when eid is null then 'create' else 'edit' end; e garments_erp.employee;
begin
 if not garments_access.has_screen_permission('employees',action) then raise exception 'Employee write access required' using errcode='42501';end if;
 if pg_column_size(p_payload)>100000 or jsonb_typeof(d)<>'object' then raise exception 'Invalid employee document';end if;
 if exists(select 1 from jsonb_object_keys(d) k where k<>'employee') or jsonb_typeof(d->'employee')<>'object'
 or exists(select 1 from jsonb_object_keys(d->'employee') k where not k=any(array['contacts_id','contact_purpose_id','contacts_emergency_id','contact_purpose_emergency_id','date_of_joining','date_of_birth','gender_id','blood_group_id','type_of_employment_id','employee_photo','supporting_document_1_title','supporting_document_2_title'])) then raise exception 'Unsupported employee field';end if;
 if nullif(d->'employee'->>'contacts_id','') is null or nullif(d->'employee'->>'contact_purpose_id','') is null then raise exception 'Select employee contact and purpose';end if;
 if nullif(d->'employee'->>'contact_purpose_emergency_id','') is not null and nullif(d->'employee'->>'contacts_emergency_id','') is null then raise exception 'Select an emergency contact before its purpose';end if;
 if eid is not null then
  select * into row from garments_erp.employee where id=eid for update;
  if not found then raise exception 'Employee no longer exists';end if;
  if md5(garments_access.employee_document(eid)::text) is distinct from expected then raise exception 'Employee changed. Reload before saving.' using errcode='40001';end if;
 end if;
 if p_proof is not null then
  select * into proof from garments_access.employee_attestation where id=p_proof for update;
  if not found or proof.actor<>auth.uid() or proof.expires_at<=now() or proof.used_at is not null or proof.payload_hash<>encode(extensions.digest(p_payload::text,'sha256'),'hex')
   or not exists(select 1 from garments_access.app_user where user_id=proof.verifier and employee_id=proof.employee_id and is_active and not must_change_password) then raise exception 'Verification expired or record changed. Verify again.' using errcode='42501';end if;
  v:=proof.employee_id;
 end if;
 select * into e from jsonb_populate_record(null::garments_erp.employee,(select jsonb_object_agg(k,case when val='""'::jsonb then 'null'::jsonb else val end) from jsonb_each(d->'employee') x(k,val)));
 if e.date_of_birth>current_date then raise exception 'Date of birth cannot be in the future';end if;
 if eid is null then
  insert into garments_erp.employee(contacts_id,contact_purpose_id) values(e.contacts_id,e.contact_purpose_id) returning id into eid;
 end if;
 update garments_erp.employee set contacts_id=e.contacts_id,contact_purpose_id=e.contact_purpose_id,contacts_emergency_id=e.contacts_emergency_id,contact_purpose_emergency_id=e.contact_purpose_emergency_id,
 date_of_joining=e.date_of_joining,date_of_birth=e.date_of_birth,gender_id=e.gender_id,blood_group_id=e.blood_group_id,type_of_employment_id=e.type_of_employment_id,employee_photo=e.employee_photo,
 supporting_document_1_title=e.supporting_document_1_title,supporting_document_2_title=e.supporting_document_2_title,verified_by_employee_id=null where id=eid;
 if v is not null then update garments_erp.employee set verified_by_employee_id=v where id=eid;end if;
 if p_proof is not null then update garments_access.employee_attestation set used_at=now() where id=p_proof;end if;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'Saved employee','employee',eid::text,jsonb_build_object('verified_by_employee_id',v::text));
 return garments_access.employee_snapshot();
end $$;
revoke all on function garments_access.save_employee(jsonb,uuid) from public,anon;
grant execute on function garments_access.save_employee(jsonb,uuid) to authenticated;
create function public.erp_save_employee(p_payload jsonb,p_proof uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select garments_access.save_employee(p_payload,p_proof); $$;
revoke all on function public.erp_save_employee(jsonb,uuid) from public,anon;
grant execute on function public.erp_save_employee(jsonb,uuid) to authenticated;

create function garments_access.save_employee_reference(p_table text,p_id bigint,p_name text,p_expected timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if p_table not in ('gender','blood_group','type_of_employment') or nullif(trim(p_name),'') is null or length(p_name)>100 then raise exception 'Invalid employee reference value';end if;
 if not garments_access.has_screen_permission('employees',case when p_id is null then 'create' else 'edit' end) then raise exception 'Employee write access required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_table,827));
 if p_id is null then execute format('insert into garments_erp.%I(name) values($1)',p_table) using trim(p_name);
 else
  execute format('update garments_erp.%I set name=$1 where id=$2 and updated_at is not distinct from $3',p_table) using trim(p_name),p_id,p_expected;
  get diagnostics changed = row_count;
  if changed<>1 then raise exception 'Reference changed. Reload before saving.' using errcode='40001';end if;
 end if;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id) values(auth.uid(),'Saved employee reference',p_table,coalesce(p_id::text,'new'));
 return garments_access.employee_snapshot();
end $$;
revoke all on function garments_access.save_employee_reference(text,bigint,text,timestamptz) from public,anon;
grant execute on function garments_access.save_employee_reference(text,bigint,text,timestamptz) to authenticated;
create function public.erp_save_employee_reference(p_table text,p_id bigint,p_name text,p_expected timestamptz) returns jsonb language sql security invoker set search_path='' as $$ select garments_access.save_employee_reference(p_table,p_id,p_name,p_expected); $$;
revoke all on function public.erp_save_employee_reference(text,bigint,text,timestamptz) from public,anon;
grant execute on function public.erp_save_employee_reference(text,bigint,text,timestamptz) to authenticated;
commit;
