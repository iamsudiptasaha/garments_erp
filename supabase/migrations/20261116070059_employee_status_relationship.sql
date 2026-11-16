begin;

lock table garments_erp.employee in access exclusive mode;

create table garments_erp.employee_status (
 id bigint primary key,
 employee_id bigint not null unique references garments_erp.employee(id) on delete cascade,
 is_active boolean not null default true,
 activated_by_employee_id bigint references garments_erp.employee(id),
 activated_at timestamptz,
 is_verified boolean not null default false,
 verified_by_employee_id bigint references garments_erp.employee(id),
 verified_at timestamptz,
 is_archived boolean not null default false,
 archived_by_employee_id bigint references garments_erp.employee(id),
 archived_at timestamptz,
 unique (employee_id,id),
 check (not is_verified or verified_by_employee_id is not null),
 check (is_archived = (archived_at is not null) and (not is_archived or not is_active))
);
alter table garments_erp.employee_status enable row level security;
revoke all on garments_erp.employee_status from public, anon, authenticated;

insert into garments_erp.employee_status
 (id,employee_id,is_active,activated_by_employee_id,is_verified,verified_by_employee_id,is_archived,archived_at,archived_by_employee_id)
select e.id,e.id,e.is_active,e.activated_by_employee_id,e.is_verified,e.verified_by_employee_id,
 e.archived_at is not null,e.archived_at,(
  select u.employee_id from garments_access.app_activity_log a
  join garments_access.app_user u on u.user_id=a.actor_user_id
  where a.action='Removed employee' and a.target_type='employee' and a.target_id=e.id::text
  order by a.created_at desc,a.id desc limit 1
 )
from garments_erp.employee e;

do $$
begin
 if exists (
  select 1 from garments_erp.employee e
  left join garments_erp.employee_status s on s.employee_id=e.id
  where s.id is null or
   row(e.is_active,e.activated_by_employee_id,e.is_verified,e.verified_by_employee_id,e.archived_at)
   is distinct from
   row(s.is_active,s.activated_by_employee_id,s.is_verified,s.verified_by_employee_id,s.archived_at)
 ) then
  raise exception 'Employee status backfill did not preserve lifecycle data';
 end if;
end;
$$;

alter table garments_erp.employee add column employee_status_id bigint;
alter table garments_erp.employee disable trigger stamp_employee_operator;
alter table garments_erp.employee disable trigger guard_archived_employee;
alter table garments_erp.employee disable trigger zz_stamp_updated_at;
update garments_erp.employee set employee_status_id=id;
alter table garments_erp.employee enable trigger guard_archived_employee;
alter table garments_erp.employee enable trigger zz_stamp_updated_at;
alter table garments_erp.employee alter column employee_status_id set not null,
 add constraint employee_current_status_fkey foreign key (id,employee_status_id)
 references garments_erp.employee_status(employee_id,id) deferrable initially deferred;

-- Keep lifecycle readers on one projection while ownership stays with the two tables.
alter table garments_erp.employee drop column is_active, drop column activated_by_employee_id,
 drop column is_verified, drop column verified_by_employee_id, drop column archived_at;

create view garments_erp.employee_with_status with (security_invoker=true) as
select e.*,s.is_active,s.activated_by_employee_id,s.activated_at,s.is_verified,
 s.verified_by_employee_id,s.verified_at,s.is_archived,s.archived_by_employee_id,s.archived_at
from garments_erp.employee e join garments_erp.employee_status s
 on s.id=e.employee_status_id and s.employee_id=e.id;
revoke all on garments_erp.employee_with_status from public, anon, authenticated;

create function garments_erp.lock_archived_employee_status()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.is_archived then raise exception 'Archived employees are read-only'; end if;
 return new;
end;
$$;
revoke all on function garments_erp.lock_archived_employee_status() from public,anon,authenticated;
create trigger lock_archived_employee_status before update on garments_erp.employee_status
for each row execute function garments_erp.lock_archived_employee_status();

CREATE OR REPLACE FUNCTION garments_erp.guard_archived_employee()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if exists (select 1 from garments_erp.employee_status where employee_id=old.id and is_archived) then
  raise exception 'Archived employees are read-only';
 end if;
 return new;
end;
$function$;

create or replace function garments_erp.stamp_employee_operator() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor bigint;
begin
 if auth.uid() is not null then
  if tg_op='UPDATE' and old.id=garments_access.profile_employee_id()
   and new.employee_photo is distinct from old.employee_photo
   and (to_jsonb(new)-array['employee_photo','updated_at']) =
       (to_jsonb(old)-array['employee_photo','updated_at']) then
   return new;
  end if;
  if not garments_access.has_screen_permission('employees',case when tg_op='INSERT' then 'create' else 'edit' end)
   then raise exception 'Employee write access required' using errcode='42501'; end if;
  select employee_id into strict actor from garments_access.app_user where user_id=auth.uid();
 end if;
 if tg_op='INSERT' then
  insert into garments_erp.employee_status
   (id,employee_id,activated_by_employee_id,activated_at,is_verified,verified_by_employee_id,verified_at)
  values(new.employee_status_id,new.id,actor,now(),actor is not null,actor,
   case when actor is not null then now() end);
 elsif actor is not null then
  update garments_erp.employee_status
  set is_verified=true,verified_by_employee_id=actor,verified_at=now()
  where employee_id=new.id;
 end if;
 return new;
end;
$$;

drop trigger stamp_employee_operator on garments_erp.employee;
-- Order status creation before the internal FK trigger when constraints are immediate.
create trigger "00_stamp_employee_operator" after insert or update on garments_erp.employee
for each row execute function garments_erp.stamp_employee_operator();

create function garments_erp.assign_employee_status_id() returns trigger
language plpgsql set search_path='' as $$
begin
 new.employee_status_id:=new.id;
 return new;
end;
$$;
revoke all on function garments_erp.assign_employee_status_id() from public,anon,authenticated;
create trigger assign_employee_status_id before insert on garments_erp.employee
for each row execute function garments_erp.assign_employee_status_id();

create or replace function garments_erp.generate_employee_code() returns trigger
language plpgsql security invoker set search_path='' as $$
declare number bigint;
begin
 if new.employee_code is null or btrim(new.employee_code)='' then
  loop
   number:=nextval('garments_erp.employee_code_seq'::regclass);
   if number>99999 then raise exception 'Employee code capacity exceeded: SCE-99999'; end if;
   new.employee_code:='SCE-'||lpad(number::text,5,'0');
   exit when not exists(select 1 from garments_erp.employee e
     where regexp_replace(e.employee_code,'[^0-9]','','g')=lpad(number::text,5,'0'));
  end loop;
 end if;
 return new;
end;
$$;
CREATE OR REPLACE FUNCTION garments_erp.save_employee(p_payload jsonb, p_proof uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare eid bigint:=nullif(p_payload->>'id','')::bigint; v bigint; row garments_erp.employee; proof garments_erp.employee_attestation; d jsonb:=p_payload->'draft'; expected text:=p_payload->>'expected'; action text:=case when eid is null then 'create' else 'edit' end; e garments_erp.employee;
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
  if md5(garments_erp.employee_document(eid)::text) is distinct from expected then raise exception 'Employee changed. Reload before saving.' using errcode='40001';end if;
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
 supporting_document_1_title=e.supporting_document_1_title,supporting_document_2_title=e.supporting_document_2_title where id=eid;


 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'Saved employee','employee',eid::text,jsonb_build_object('verified_by_employee_id',v::text));
 return garments_erp.employee_snapshot() || jsonb_build_object('_saved_id', eid::text);
end $function$;
CREATE OR REPLACE FUNCTION garments_erp.set_employee_active(p_id bigint, p_active boolean, p_expected text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform pg_advisory_xact_lock(71426,1);
 if not garments_access.has_screen_permission('employees','edit') then raise exception 'Employee write access required' using errcode='42501';end if;
 if p_active is null then raise exception 'Choose active or inactive';end if;
 perform 1 from garments_erp.employee where id=p_id for update;
 if not found or md5(garments_erp.employee_document(p_id)::text) is distinct from p_expected
   then raise exception 'Employee changed. Reload before saving.' using errcode='40001';end if;
 update garments_erp.employee_status
 set is_active=p_active, activated_at=now(), verified_at=now(), is_verified=true,
  activated_by_employee_id=garments_access.profile_employee_id(),
  verified_by_employee_id=garments_access.profile_employee_id()
 where employee_id=p_id;
 if not p_active then
  update garments_access.app_user set is_active=false,version=version+1
    where employee_id=p_id and is_active;
  if found and not garments_access.has_eligible_administrator() then
   raise exception 'Keep at least one active Administrator with completed setup';
  end if;
  delete from auth.sessions where user_id in (
    select user_id from garments_access.app_user where employee_id=p_id
  );
 end if;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details)
 values(auth.uid(),case when p_active then 'Activated employee' else 'Deactivated employee' end,
   'employee',p_id::text,jsonb_build_object('is_active',p_active));
 return garments_erp.employee_document(p_id);
end $function$;
CREATE OR REPLACE FUNCTION garments_erp.archive_employee(p_id bigint, p_expected text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 account garments_access.app_user;
 pending garments_access.employee_invitation;
 archived timestamptz;
begin
 -- Serialize against role, account, invitation and employee status changes.
 perform pg_advisory_xact_lock(71426,1);
 perform garments_access.require_administrator();
 if not garments_access.has_screen_permission('employees','edit') then
  raise exception 'Employee write access required' using errcode='42501';
 end if;
 if p_id=garments_access.profile_employee_id() then
  raise exception 'Ask another Administrator to remove your employee profile' using errcode='42501';
 end if;

 perform 1 from garments_erp.employee where id=p_id for update;
 select archived_at into archived from garments_erp.employee_status where employee_id=p_id;
 if not found then raise exception 'Employee no longer exists'; end if;
 if archived is not null then return; end if;
 if md5(garments_erp.employee_document(p_id)::text) is distinct from p_expected then
  raise exception 'Employee changed. Reload before removing.' using errcode='40001';
 end if;

 select * into account from garments_access.app_user where employee_id=p_id;
 if found then
  perform garments_access.change_account_lifecycle('remove', account.user_id, p_id, account.version);
 end if;

 -- The Auth invitation trigger may bind an identity before the invitation finishes.
 -- Lock the reservation and cancel its nonce even when no Auth identity exists yet.
 select * into pending from garments_access.employee_invitation where employee_id=p_id for update;
 if found then
  if pending.user_id is not null then
   perform 1 from auth.users where id=pending.user_id for update;
   if exists(select 1 from garments_access.app_user where user_id=pending.user_id) then
    raise exception 'Invitation identity belongs to another account';
   end if;
   perform garments_access.retire_auth_identity(pending.user_id);
  end if;
  insert into garments_access.cancelled_employee_invitation(nonce,user_id)
  values(pending.nonce,pending.user_id);
  delete from garments_access.employee_invitation where employee_id=p_id;
 end if;

 update garments_erp.employee_status
 set is_active=false,is_archived=true,archived_at=now(),archived_by_employee_id=garments_access.profile_employee_id()
 where employee_id=p_id;
 if not garments_access.has_eligible_administrator() then
  raise exception 'Keep at least one active Administrator with completed setup';
 end if;
 insert into garments_access.app_activity_log(actor_user_id,app_resource_id,action,target_type,target_id)
 select auth.uid(), id, 'Removed employee', 'employee', p_id::text
 from garments_access.app_resource where key='employees';
end;
$function$;
CREATE OR REPLACE FUNCTION garments_access.guard_archived_employee_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from garments_erp.employee_status where employee_id=new.employee_id and is_archived) then
  raise exception 'Archived employees cannot receive login access' using errcode='42501';
 end if;
 return new;
end;
$function$;
CREATE OR REPLACE FUNCTION garments_erp.employee_document(p_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
 'employee',garments_erp.fabric_json('employee',to_jsonb(e)) || (status.document - array['id','employee_id']),
 'status',status.document,
 'contact',jsonb_build_object('id',c.id::text,'company_name',c.company_name),
 'contacts',(select coalesce(jsonb_agg(garments_erp.fabric_json('contact_items',to_jsonb(x)) order by x.id),'[]') from garments_erp.contact_items x where x.contact_id=e.contacts_id),
 'emergency',(select jsonb_build_object('id',x.id::text,'company_name',x.company_name) from garments_erp.contacts x where x.id=e.contacts_emergency_id),
 'verifier_name',(select x.company_name from garments_erp.employee v join garments_erp.contacts x on x.id=v.contacts_id where v.id=s.verified_by_employee_id))
 from garments_erp.employee e join garments_erp.contacts c on c.id=e.contacts_id
 join garments_erp.employee_status s on s.id=e.employee_status_id
 cross join lateral (select garments_erp.fabric_json('employee_status',to_jsonb(s)) as document) status
 where e.id=p_id;
$function$;

CREATE OR REPLACE FUNCTION garments_access.session_ready()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(auth.jwt()->>'aal'='aal2',false)
 and coalesce(auth.jwt()->'amr' @> '[{"method":"password"}]'::jsonb,false)
 and exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
 and exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.factor_type='totp' and f.status='verified')
 and exists(select 1 from garments_access.app_user u join garments_erp.employee_with_status e on e.id=u.employee_id and e.is_active where u.user_id=auth.uid() and u.is_active and not u.must_change_password);
$function$;

CREATE OR REPLACE FUNCTION garments_access.admin_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform garments_access.require_administrator();
 return jsonb_build_object(
 'roles',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from garments_access.app_role r),
 'resources',(select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order),'[]'::jsonb) from garments_access.app_resource r),
 'permissions',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from garments_access.app_role_resource_permission p),
 'accounts',(select coalesce(jsonb_agg(jsonb_build_object('user_id',u.user_id,'employee_id',u.employee_id,'is_active',u.is_active,'version',u.version,'employee_code',e.employee_code,'name',c.company_name,'role_ids',(select coalesce(jsonb_agg(ur.role_id),'[]'::jsonb) from garments_access.app_user_role ur where ur.user_id=u.user_id))),'[]'::jsonb) from garments_access.app_user u join garments_erp.employee_with_status e on e.id=u.employee_id left join garments_erp.contacts c on c.id=e.contacts_id),
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'employee_code',e.employee_code,'name',c.company_name,'is_active',e.is_active)),'[]'::jsonb) from garments_erp.employee_with_status e left join garments_erp.contacts c on c.id=e.contacts_id where e.archived_at is null),
 'auth_accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'invitation_pending',u.invited_at is not null and u.email_confirmed_at is null,'setup_pending',coalesce(a.must_change_password,false),'mfa_enrolled',exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.factor_type='totp' and f.status='verified'))),'[]'::jsonb) from auth.users u left join garments_access.app_user a on a.user_id=u.id where not exists(select 1 from garments_access.cancelled_employee_invitation x where x.user_id=u.id)),
 'pending_invitations',(select coalesce(jsonb_agg(jsonb_build_object('employee_id',i.employee_id,'email',i.email,'role_ids',i.role_ids,'revision',i.revision)),'[]'::jsonb) from garments_access.employee_invitation i where not exists(select 1 from garments_access.app_user u where u.employee_id=i.employee_id)),
 'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) from (select * from garments_access.app_activity_log order by created_at desc,id desc limit 200) a)
 );
end;
$function$;

CREATE OR REPLACE FUNCTION garments_access.save_account_access(p_user_id uuid, p_employee_id bigint, p_role_ids bigint[], p_enabled boolean, p_expected_version bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare account garments_access.app_user;
begin
 perform pg_advisory_xact_lock(71426,1);
 perform garments_access.require_administrator();
 if p_enabled and not exists(select 1 from garments_erp.employee_with_status e where e.id=p_employee_id and e.is_active)
  then raise exception 'Select an active employee'; end if;
 if p_enabled is null or coalesce(cardinality(p_role_ids),0)=0 then raise exception 'Choose at least one role and an account status'; end if;
 if exists(select 1 from unnest(p_role_ids) id where not exists(select 1 from garments_access.app_role r where r.id=id and r.is_active)) then raise exception 'Choose active roles'; end if;
 select * into account from garments_access.app_user where user_id=p_user_id for update;
 if found then
  if p_expected_version is distinct from account.version then raise exception 'Account changed. Reload before saving' using errcode='40001'; end if;
  if account.employee_id<>p_employee_id then raise exception 'An account cannot be moved to a different employee'; end if;
  update garments_access.app_user set is_active=p_enabled,version=version+1 where user_id=p_user_id;
  if account.is_active is distinct from p_enabled then
   delete from auth.sessions where user_id=p_user_id;
  end if;
 else
  if p_expected_version is not null then raise exception 'Account no longer exists'; end if;
  insert into garments_access.app_user(user_id,employee_id,is_active,created_by) values(p_user_id,p_employee_id,p_enabled,auth.uid());
 end if;
 delete from garments_access.app_user_role where user_id=p_user_id;
 insert into garments_access.app_user_role(user_id,role_id,created_by) select p_user_id,id,auth.uid() from (select distinct unnest(p_role_ids) id) r;
 if not garments_access.has_eligible_administrator() then raise exception 'Keep at least one active Administrator with completed setup'; end if;
 insert into garments_access.app_activity_log(actor_user_id,app_resource_id,action,target_type,target_id,details)
 select auth.uid(),r.id,'Updated account access','app_user',p_user_id::text,jsonb_build_object('employee_id',p_employee_id,'enabled',p_enabled,'role_ids',p_role_ids) from garments_access.app_resource r where key='adminAccess';
end;
$function$;

CREATE OR REPLACE FUNCTION garments_access.account_security()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('enabled',coalesce(u.is_active and e.is_active,false),'mustChangePassword',coalesce(u.must_change_password,false),'ready',garments_access.session_ready(),
  'requiresPasswordSignIn',not coalesce(auth.jwt()->'amr' @> '[{"method":"password"}]'::jsonb,false))
 from (select auth.uid() as id) a left join garments_access.app_user u on u.user_id=a.id left join garments_erp.employee_with_status e on e.id=u.employee_id where a.id is not null;
$function$;

CREATE OR REPLACE FUNCTION garments_erp.move_production(p_payload jsonb, p_proof uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare action text:=p_payload->>'action'; pid bigint; source garments_erp.job; dest bigint;
 target_stage garments_erp.stage; current_stage garments_erp.stage; verifier bigint; expected_visit bigint; actual_visit bigint; quantities jsonb; expected_count integer;
 path bigint[]; part bigint; handoff_source bigint; variant_count integer; item bigint;
 operation text:=case when action='start' then 'create' else 'edit' end;
begin
 -- A previous command in the same transaction may have flushed constraints.
 -- Allow the atomic switch to pass through zero current jobs, then validate
 -- again before returning from this guarded command.
 set constraints all deferred;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>1000000
   or action is null or action not in ('start','advance','rectify') or exists(select 1 from jsonb_object_keys(p_payload) k
     where not k=any(array['action','production_id','item_part_id','from_job_id','to_job_id','to_stage_id','start_date','due_date','job_worker_id','item_status_list_id','reason','verified_by','expected_transition_id','pieces']))
   then raise exception 'Invalid production command';end if;
 if not garments_access.has_screen_permission('productionJobs',operation)
   then raise exception 'Production write access required' using errcode='42501';end if;
 -- The selected employee is a recorded MVP attribution, not a password proof.
 -- Portal session/role authorization remains mandatory and supplies the actor.
 if p_proof is not null then raise exception 'Password proofs are no longer used for Production';end if;
 verifier := (p_payload->>'verified_by')::bigint;
 if verifier is null or not exists(select 1 from garments_erp.employee_with_status where id=verifier and is_active)
   then raise exception 'Select an active employee';end if;
 quantities := coalesce(p_payload->'pieces','[]'::jsonb);
 if jsonb_typeof(quantities)<>'array' or jsonb_array_length(quantities)>10000
   then raise exception 'Invalid handover quantities';end if;
 if action='start' then
  if jsonb_array_length(quantities)<>0 then raise exception 'Starting production does not submit output';end if;
  part:=(p_payload->>'item_part_id')::bigint;
  perform 1 from garments_erp.item_part where id=part for update;
  if not found then raise exception 'Select an existing item part';end if;
  insert into garments_erp.production(item_part_id) values(part) returning id into pid;
  insert into garments_erp.task_board_data(production_id) values(pid);
  select * into target_stage from garments_erp.stage order by sort_order limit 1;
  if target_stage.id is null or (p_payload->>'to_stage_id')::bigint is distinct from target_stage.id
    then raise exception 'Production must start at the first stage';end if;
 else
  pid:=(p_payload->>'production_id')::bigint;
  select item_part_id into part from garments_erp.production where id=pid for update;
  if not found then raise exception 'Production does not exist';end if;
  select * into source from garments_erp.job where production_id=pid and latest for update;
  if source.id is null or source.id is distinct from (p_payload->>'from_job_id')::bigint
    then raise exception 'Current job changed. Reload before moving production.' using errcode='40001';end if;
  -- Current job plus latest transition identifies a visit, even after Rectify
  -- reopens an original job. Replaying an old visit cannot hand it over twice.
  select coalesce(max(id),0) into actual_visit from garments_erp.job_transition_log where production_id=pid;
  expected_visit:=(p_payload->>'expected_transition_id')::bigint;
  if expected_visit is null or expected_visit<>actual_visit
    then raise exception 'Current visit changed. Reload before handing over.' using errcode='40001';end if;
  path:=garments_erp.production_path(pid);
  select * into current_stage from garments_erp.stage where id=source.stage_id;
  if current_stage.track_pieces and not current_stage.pp_stage then
   -- Every current part variant x item size must be submitted exactly once.
   select ip.item_id into item from garments_erp.item_part ip where ip.id=part;
   select count(*) into expected_count from garments_erp.variant_item vi
    cross join garments_erp.item_size_list sz where vi.item_part_id=part and sz.item_id=item;
   if expected_count=0 or jsonb_array_length(quantities)<>expected_count then
    raise exception 'Fill pieces for every variant and size before handover';end if;
   if exists(select 1 from jsonb_array_elements(quantities) q
    where jsonb_typeof(q)<>'object' or (select count(*) from jsonb_object_keys(q))<>3
     or not q ?& array['variant_item_id','item_size_list_id','pieces_stock_out']
     or jsonb_typeof(q->'pieces_stock_out') is distinct from 'number'
     or (q->>'pieces_stock_out')::numeric<0
     or (q->>'pieces_stock_out')::numeric<>trunc((q->>'pieces_stock_out')::numeric)
     or (q->>'pieces_stock_out')::numeric>= 'Infinity'::numeric
     or not exists(select 1 from garments_erp.variant_item vi
      join garments_erp.variant_item_per_job vj on vj.variant_item_id=vi.id and vj.job_id=source.id
      join garments_erp.item_size_list sz on sz.id=(q->>'item_size_list_id')::bigint and sz.item_id=item
      join garments_erp.stage_pieces sp on sp.variant_item_per_job_id=vj.id and sp.item_size_list_id=sz.id
      where vi.id=(q->>'variant_item_id')::bigint and vi.item_part_id=part))
    or (select count(distinct ((q->>'variant_item_id')::bigint,(q->>'item_size_list_id')::bigint)) from jsonb_array_elements(quantities) q)<>expected_count
    then raise exception 'Fill valid whole pieces once for every linked variant and size';end if;
   update garments_erp.stage_pieces sp set pieces_stock_out=(q->>'pieces_stock_out')::numeric
    from jsonb_array_elements(quantities) q, garments_erp.variant_item_per_job vj
    where vj.job_id=source.id and vj.variant_item_id=(q->>'variant_item_id')::bigint
     and sp.variant_item_per_job_id=vj.id and sp.item_size_list_id=(q->>'item_size_list_id')::bigint;
  elsif jsonb_array_length(quantities)<>0 then
   raise exception 'This stage does not track pieces';
  end if;
  if action='rectify' then
   dest:=(p_payload->>'to_job_id')::bigint;
   if dest is null or dest=source.id or not dest=any(path)
     then raise exception 'Select an earlier job on the current path';end if;
   if nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'Rectification requires a reason';end if;
   update garments_erp.job set latest=false where id=source.id;
   update garments_erp.job set latest=true,complete_date=null where id=dest and production_id=pid;
  else
   select * into target_stage from garments_erp.stage where id=(p_payload->>'to_stage_id')::bigint and sort_order>current_stage.sort_order;
   if target_stage.id is null or target_stage.id is distinct from (p_payload->>'to_stage_id')::bigint
     then raise exception 'Select a later stage';end if;
   update garments_erp.job set latest=false,complete_date=coalesce(complete_date,current_date) where id=source.id;
  end if;
 end if;
 if action in ('start','advance') then
  insert into garments_erp.job(production_id,stage_id,job_code,start_date,due_date,job_worker_id,latest)
  values(pid,target_stage.id,garments_erp.generate_job_code(target_stage.id),
    coalesce((p_payload->>'start_date')::date,current_date),(p_payload->>'due_date')::date,
    (p_payload->>'job_worker_id')::bigint,true) returning id into dest;
  insert into garments_erp.job_item_status_list(job_id,date,item_status_list_id)
  values(dest,current_date,(p_payload->>'item_status_list_id')::bigint);
  insert into garments_erp.variant_item_per_job(job_id,variant_item_id)
  select dest,id from garments_erp.variant_item where item_part_id=part;
  if target_stage.track_pieces and not target_stage.pp_stage then
   select j.id into handoff_source from unnest(path) with ordinality route(jid,n)
   join garments_erp.job j on j.id=route.jid join garments_erp.stage s on s.id=j.stage_id
   where s.track_pieces and not s.pp_stage order by route.n desc limit 1;
   if handoff_source is not null then
    -- Only the actual source attempt supplies output; abandoned attempts are
    -- neither aggregated nor reused, and challans are never copied.
    insert into garments_erp.stage_pieces(variant_item_per_job_id,item_size_list_id,pieces_stock_in,pieces_stock_out)
    select nl.id,p.item_size_list_id,p.pieces_stock_out,0
    from garments_erp.variant_item_per_job oldlink join garments_erp.stage_pieces p on p.variant_item_per_job_id=oldlink.id
    join garments_erp.variant_item_per_job nl on nl.job_id=dest and nl.variant_item_id=oldlink.variant_item_id
    where oldlink.job_id=handoff_source;
   else
    -- First tracked stage: equal-share/largest-remainder allocation by variant
    -- ID, preserving each planned size total and the pilot share_weight=1 rule.
    select item_id into item from garments_erp.item_part where id=part;
    select count(*) into variant_count from garments_erp.variant_item_per_job where job_id=dest;
    if variant_count=0 then raise exception 'Tracked production requires at least one variant';end if;
    insert into garments_erp.stage_pieces(variant_item_per_job_id,item_size_list_id,pieces_stock_in,pieces_stock_out)
    select vl.id,sz.item_size_list_id,trunc(sz.pieces/variant_count)+case when vl.n<=mod(sz.pieces,variant_count) then 1 else 0 end,0
    from (select id,row_number() over(order by variant_item_id) n from garments_erp.variant_item_per_job where job_id=dest) vl
    cross join (select cr.item_size_list_id,cr.pieces from garments_erp.item_cut_ratio cr
      join garments_erp.item_size_list s on s.id=cr.item_size_list_id where s.item_id=item) sz;
   end if;
  end if;
 end if;
 if action<>'start' then
  insert into garments_erp.job_transition_log(production_id,from_job_id,to_job_id,action,verified_by,actor_user_id,reason,handover_pieces)
  values(pid,source.id,dest,action,verifier,auth.uid(),p_payload->>'reason',quantities);
 end if;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details)
 values(auth.uid(),'Production '||action,'production',pid::text,jsonb_build_object('job_id',dest::text,'verified_by',verifier::text));
 -- Validate while still inside the guarded owner context, as Fabric commands
 -- already do. Browser roles deliberately have no direct table privileges.
 set constraints all immediate;
 return jsonb_build_object('production_id',pid::text,'job_id',dest::text,'current_path',
   (select jsonb_agg(x::text order by n) from unnest(garments_erp.production_path(pid)) with ordinality a(x,n)),
   'transition_id',(select coalesce(max(id),0)::text from garments_erp.job_transition_log where production_id=pid),
   'stale_job_ids',(select coalesce(jsonb_agg(j.id::text order by j.id),'[]') from garments_erp.job j
     where j.production_id=pid and not j.id=any(garments_erp.production_path(pid))));
end $function$;

CREATE OR REPLACE FUNCTION garments_erp.production_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not garments_access.has_screen_permission('productionJobs','view') then raise exception 'Production access required' using errcode='42501';end if;
 return jsonb_build_object('records',(select coalesce(jsonb_agg(garments_erp.production_document(p.id)||jsonb_build_object('revision',md5(garments_erp.production_document(p.id)::text)) order by p.id),'[]') from garments_erp.production p),
 'stages',(select coalesce(jsonb_agg(garments_erp.fabric_json('stage',to_jsonb(s)) order by sort_order),'[]') from garments_erp.stage s),
 'statuses',(select coalesce(jsonb_agg(garments_erp.fabric_json('item_status_list',to_jsonb(s)) order by id),'[]') from garments_erp.item_status_list s),
 'flags',(select coalesce(jsonb_agg(garments_erp.fabric_json('flags_list',to_jsonb(f)) order by id),'[]') from garments_erp.flags_list f),
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'name',c.company_name,'code',e.employee_code) order by e.id),'[]')
   from garments_erp.employee_with_status e join garments_erp.contacts c on c.id=e.contacts_id where e.is_active),
 'verifiers',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'name',c.company_name,'email',a.email) order by e.id),'[]')
   from garments_erp.employee_with_status e join garments_erp.contacts c on c.id=e.contacts_id
   join garments_access.app_user u on u.employee_id=e.id join auth.users a on a.id=u.user_id
   where garments_access.production_user_allowed(u.user_id,'edit')));
end $function$;

CREATE OR REPLACE FUNCTION garments_access.production_user_allowed(p_user uuid, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from garments_access.app_user u join garments_erp.employee_with_status e on e.id=u.employee_id
 join auth.users a on a.id=u.user_id
 join garments_access.app_user_role ur on ur.user_id=u.user_id
 join garments_access.app_role role on role.id=ur.role_id and role.is_active
 join garments_access.app_resource r on r.key='productionJobs' and garments_access.resource_available(r.id)
 left join garments_access.app_role_resource_permission p on p.app_role_id=role.id and p.app_resource_id=r.id
 where u.user_id=p_user and u.is_active and e.is_active and not u.must_change_password
 and a.deleted_at is null and (a.banned_until is null or a.banned_until<=now())
 and p_action in ('create','edit') and (not r.admin_only or role.is_system_admin)
 and (role.is_system_admin or (p.can_view and case when p_action='create' then p.can_create else p.can_edit end)));
$function$;

CREATE OR REPLACE FUNCTION garments_access.dyed_bill_user_allowed(p_user uuid, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from garments_access.app_user u join garments_erp.employee_with_status e on e.id=u.employee_id
 join auth.users a on a.id=u.user_id
 join garments_access.app_user_role ur on ur.user_id=u.user_id
 join garments_access.app_role role on role.id=ur.role_id and role.is_active
 join garments_access.app_resource r on r.key='dyeBills' and garments_access.resource_available(r.id)
 left join garments_access.app_role_resource_permission p on p.app_role_id=role.id and p.app_resource_id=r.id
 where u.user_id=p_user and u.is_active and e.is_active and e.is_verified and not u.must_change_password
 and a.deleted_at is null and (a.banned_until is null or a.banned_until<=now())
 and p_action in ('create','edit') and (not r.admin_only or role.is_system_admin)
 and (role.is_system_admin or (p.can_view and case when p_action='create' then p.can_create else p.can_edit end)));
$function$;

CREATE OR REPLACE FUNCTION garments_erp.production_workspace()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb:='{}';t text;rows jsonb;keys text[]:=array(select jsonb_object_keys(garments_erp.production_setup_contract())); jobs boolean:=garments_access.has_screen_permission('productionJobs','view');
begin
 if not jobs and not exists(select 1 from unnest(keys) k where garments_access.has_screen_permission(k,'view')) then raise exception 'Production access required' using errcode='42501';end if;
 -- Closed table allowlist plus current per-screen permission. No HR/contact documents or storage paths.
 for t in select distinct d.table_name from garments_access.app_db_table d
 join garments_access.app_resource_table m on m.app_db_table_id=d.id
 join garments_access.app_resource r on r.id=m.app_resource_id
 where d.schema_name='garments_erp' and r.key=any(keys) and m.can_view and garments_access.has_screen_permission(r.key,'view')
 and d.table_name=any(array['item','item_part','item_size_list','item_cut_ratio','variant','variant_item','production_checklist','part_list','size_list','stage','stage_type','product_type_list','gender','flags_list','job_worker','item_status_list','brand_list','contact_purpose','lab_dip','lab_dip_version','lab_dip_version_status','color_map','color_map_by_brand'])
 union select unnest(case when jobs then array['item','item_part','item_size_list','item_cut_ratio','variant','variant_item','production_checklist','part_list','size_list','stage','stage_type','item_status_list','flags_list','brand_list','job_worker','job','job_item_status_list','variant_item_per_job','stage_pieces','production','task_board_data','job_assignees','task_board_data_flag','job_transition_log'] else array[]::text[] end)
 loop
  execute format('select coalesce(jsonb_agg(garments_erp.fabric_json(%L,to_jsonb(x)) order by x.id),''[]''::jsonb) from garments_erp.%I x',t,t) into rows;
  result:=result||jsonb_build_object(t,rows);
 end loop;
 -- Contacts only supply linked labels, never contact children or financial details.
 if jobs or garments_access.has_screen_permission('productionWorkers','view') then
 result:=result||jsonb_build_object('contacts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id::text,'company_name',c.company_name)),'[]') from garments_erp.contacts c where garments_access.has_screen_permission('productionWorkers','view') or exists(select 1 from garments_erp.job_worker w where w.contacts_id=c.id)));
 end if;
 if jobs then
 result:=result||jsonb_build_object('employee',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'name',c.company_name,'employee_code',e.employee_code,'is_active',true) order by e.id),'[]') from garments_erp.employee_with_status e join garments_erp.contacts c on c.id=e.contacts_id where e.is_active),
 'production_records',(garments_erp.production_snapshot()->'records'));
 end if;
 if jobs or garments_access.has_screen_permission('productionItems','view') then
 result:=result||jsonb_build_object('production_job_counts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select p.item_part_id::text,item_count.jobs from garments_erp.production p cross join lateral (select count(*)::integer jobs from garments_erp.job j where j.production_id=p.id) item_count) x));
 end if;
 if jobs or garments_access.has_screen_permission('productionWorkers','view') then
 result:=result||jsonb_build_object('production_worker_counts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select job_worker_id::text,count(*)::integer jobs from garments_erp.job where job_worker_id is not null group by job_worker_id) x));
 end if;
 result:=result||jsonb_build_object('attachments',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'filename',a.filename,'mime_type',a.mime_type)),'[]') from garments_erp.attachments a where a.id::text in(select x->>'image_attachment' from jsonb_array_elements(coalesce(result->'item','[]')) x)),'_live',true);
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.erp_billing_command(p_request_id uuid, p_employee_id bigint, p_command jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  invoice_id bigint := (p_command->>'billing_id')::bigint;
  line_id bigint := (p_command->>'line_id')::bigint;
  po_id bigint := (p_command->>'po_item_id')::bigint;
  variation_id bigint := (p_command->>'variation_id')::bigint;
  version_id bigint := (p_command->>'price_version_id')::bigint;
  sets integer := (p_command->>'sets')::integer;
  action text := p_command->>'action';
  buyer_id bigint := (p_command->>'buyer_list_id')::bigint;
  shadow_id bigint;
  formal_id bigint := (p_command->>'formal_po_id')::bigint;
  entered_number text := nullif(btrim(p_command->>'invoice_number'), '');
  entered_gst numeric := (p_command->>'gst_percentage')::numeric;
  po_product_type_id bigint := (p_command->>'product_type_list_id')::bigint;
  hsn_by_size jsonb := p_command->'hsn_by_size';
  po_line garments_erp.po_item%rowtype;
  invoice_status text;
  invoice_mode text;
  previous jsonb;
  components jsonb;
  set_price numeric;
  prior garments_erp.billing_audit%rowtype;
  old_line garments_erp.billing_item%rowtype;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Billing commands require read committed isolation';
  end if;
  if p_request_id is null or not exists (
    select 1 from garments_erp.employee_with_status where id = p_employee_id and is_active
  ) then raise exception 'Request ID and active employee required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into prior from garments_erp.billing_audit where request_id = p_request_id;
  if found then
    if (prior.command, prior.employee_id) is distinct from (p_command, p_employee_id) then
      raise exception 'Request ID already used';
    end if;
    return prior.billing_id;
  end if;

  if action = 'create' then
    if coalesce((p_command->>'adhoc')::boolean, false) then
      if formal_id is not null or buyer_id is null then raise exception 'Ad-hoc billing requires only a buyer'; end if;
      insert into garments_erp.buyer_po (po_number, buyer_list_id, po_issue_date, po_source_type_id)
      values ('ADHOC-' || p_request_id, buyer_id, (p_command->>'invoice_date')::date, garments_erp.adhoc_po_source_id())
      returning id into shadow_id;
    else
      select h.buyer_list_id into buyer_id
      from garments_erp.buyer_po h
      where h.id = formal_id and h.po_source_type_id = garments_erp.formal_po_source_id()
        and h.cancelled_at is null
      for share;
      if not found then raise exception 'Select an active formal PO'; end if;
      if not exists (
        select 1 from garments_erp.po_item p
        join garments_erp.sale_mode_type m on m.id = p.sale_mode_type_id
        where p.buyer_po_id = formal_id and m.type = p_command->>'mode'
      ) then raise exception 'The selected PO has no lines for this sale mode'; end if;
    end if;
    insert into garments_erp.billing (invoice_number, invoice_date, billing_status_type_id, sale_mode_type_id,
                                      buyer_list_id, adhoc_po_id, formal_po_id, gst_percentage)
    values (entered_number, (p_command->>'invoice_date')::date,
      (select id from garments_erp.billing_status_type where type = 'draft'),
      (select id from garments_erp.sale_mode_type where type = p_command->>'mode'), buyer_id, shadow_id, formal_id, entered_gst)
    returning id into invoice_id;
  else
    select st.type, mode.type, b.buyer_list_id, b.adhoc_po_id, b.formal_po_id
      into strict invoice_status, invoice_mode, buyer_id, shadow_id, formal_id
    from garments_erp.billing b
    join garments_erp.billing_status_type st on st.id = b.billing_status_type_id
    join garments_erp.sale_mode_type mode on mode.id = b.sale_mode_type_id
    where b.id = invoice_id for update of b;
    previous := garments_erp.billing_snapshot(invoice_id);
    if invoice_status not in ('draft', 'finalized') then raise exception 'Invoice is immutable'; end if;

    if action = 'save_header' and invoice_status = 'draft' then
      update garments_erp.billing b set
        invoice_number = case when p_command ? 'invoice_number' then entered_number else b.invoice_number end,
        gst_percentage = case when p_command ? 'gst_percentage' then entered_gst else b.gst_percentage end,
        invoice_date = case when p_command ? 'invoice_date' then (p_command->>'invoice_date')::date else b.invoice_date end
      where b.id = invoice_id;
    elsif action in ('save_line', 'remove_line') then
      if line_id is not null then
        select * into strict old_line from garments_erp.billing_item
        where id = line_id and billing_id = invoice_id;
        if exists (
          select 1 from garments_erp.carton_item ci
          join garments_erp.transport_item ti on ti.carton_id = ci.carton_id
          join garments_erp.transport t on t.id = ti.transport_id
          where ci.billing_item_id = line_id and t.dispatched_at is not null
        ) then raise exception 'A dispatched carton freezes its billed line'; end if;
      end if;
      if action = 'save_line' then
        if shadow_id is not null then
          if po_id is not null then raise exception 'Ad-hoc billing owns its PO'; end if;
          po_id := old_line.po_item_id;
        else
          perform id from garments_erp.po_item
          where id in (po_id, old_line.po_item_id) order by id for update;
          select p.* into strict po_line
          from garments_erp.po_item p
          join garments_erp.buyer_po h on h.id = p.buyer_po_id
          where p.id = po_id and h.id = formal_id and h.cancelled_at is null
          for share of h;
        end if;
      end if;

      if action = 'save_line' and invoice_mode = 'standard' then
        if sets is null or sets < 1 then raise exception 'Positive set quantity required'; end if;
        variation_id := coalesce(variation_id, po_line.sellable_product_id);
        if shadow_id is null and (
          po_line.ordered_units is null or po_line.sellable_product_id is distinct from variation_id
        ) then raise exception 'Standard billing requires a matching standard PO line'; end if;
        set_price := (p_command->>'unit_price')::numeric;
        if set_price is null or set_price < 0 or set_price >= 'Infinity'::numeric then
          raise exception 'Explicit unit price required';
        end if;
        perform 1 from garments_erp.sellable_product
        where id = variation_id and is_active and verified_at is not null
          and verified_by_employee_id is not null for share;
        if not found then raise exception 'Verified active product required'; end if;
        if version_id is not null then
          perform 1 from garments_erp.item_in_store_price
          where id = version_id and sellable_product_id = variation_id for share;
          if not found then raise exception 'Price version belongs to another product'; end if;
        end if;
        if shadow_id is null then
          select jsonb_agg(jsonb_build_object(
            'size_id', item_size_list_id, 'pieces', share_weight::bigint * sets, 'weight', share_weight
          )) into components from garments_erp.po_item_piece_per_size where po_item_id = po_id;
          if exists (
            select 1
            from (select item_size_list_id, share_weight from garments_erp.po_item_piece_per_size
                  where po_item_id = po_id) ordered
            full join (select item_size_list_id, share_weight from garments_erp.sellable_unit
                       where sellable_product_id = variation_id) recipe using (item_size_list_id)
            where ordered.share_weight is distinct from recipe.share_weight
          ) then raise exception 'PO composition differs from the verified product'; end if;
          if exists (
            select 1 from garments_erp.po_item_piece_per_size
            where po_item_id = po_id and (
              share_weight is null or pieces_ordered <> share_weight::bigint * po_line.ordered_units
            )
          ) then raise exception 'Invalid standard PO composition'; end if;
        else
          select jsonb_agg(jsonb_build_object(
            'size_id', item_size_list_id, 'pieces', share_weight::bigint * sets, 'weight', share_weight
          )) into components from garments_erp.sellable_unit where sellable_product_id = variation_id;
        end if;
      elsif action = 'save_line' then
        if variation_id is not null or version_id is not null or sets is not null then
          raise exception 'Exception billing takes only physical pieces and prices';
        end if;
        if po_line.sellable_product_id is not null then
          raise exception 'Exception billing requires an exception PO line';
        end if;
        components := p_command->'pieces';
      else
        components := '[]'::jsonb;
      end if;

      if action = 'save_line' and (
        jsonb_typeof(components) is distinct from 'array' or components = '[]'::jsonb
      ) then raise exception 'At least one size component required'; end if;
      if action = 'save_line' and exists (
        select 1 from jsonb_array_elements(components) part
        where not exists (
          select 1 from garments_erp.item_produced_pieces produced
          where produced.item_size_list_id = (part->>'size_id')::bigint and produced.pieces > 0
        )
      ) then raise exception 'Every billed size requires recorded production stock-in'; end if;

      if action = 'save_line' and old_line.sellable_product_id is distinct from variation_id
         and exists (select 1 from garments_erp.carton_item where billing_item_id = line_id) then
        raise exception 'Remove carton allocations before changing the packed variation';
      end if;
      perform i.id from garments_erp.item i
      where i.id in (
        select s.item_id from garments_erp.item_size_list s
        where s.id in (
          select p.item_size_list_id from garments_erp.billing_item_piece_per_size p
          where p.billing_item_id = line_id
          union
          select (part->>'size_id')::bigint from jsonb_array_elements(components) part
        )
      ) order by i.id for update;


      if action = 'remove_line' then
        if line_id is null then raise exception 'Billing line required'; end if;
        if invoice_status = 'finalized' and not exists (
          select 1 from garments_erp.billing_item where billing_id = invoice_id and id <> line_id
        ) then raise exception 'A finalized invoice requires at least one line'; end if;
        delete from garments_erp.billing_item_piece_per_size where billing_item_id = line_id;
        delete from garments_erp.billing_item where id = line_id;
        if shadow_id is not null then
          delete from garments_erp.po_item_piece_per_size where po_item_id = old_line.po_item_id;
          delete from garments_erp.po_item where id = old_line.po_item_id;
        end if;
      else
        if exists (
          select 1 from jsonb_to_recordset(components) as c(size_id bigint, pieces numeric, price numeric)
          where c.size_id is null or c.pieces is null or c.pieces <= 0 or c.pieces <> trunc(c.pieces)
            or (invoice_mode = 'exception' and c.price is null)
        ) then raise exception 'Each component requires a size, whole pieces and an exception price'; end if;
        if shadow_id is not null then
          if po_product_type_id is null then
            raise exception 'Ad-hoc PO product type required';
          end if;
          if jsonb_typeof(hsn_by_size) is distinct from 'object' or exists (
            select 1 from jsonb_to_recordset(components) as c(size_id bigint)
            where jsonb_typeof(hsn_by_size->(c.size_id::text)) is distinct from 'string'
              or nullif(btrim(hsn_by_size->>(c.size_id::text)), '') is null
          ) then raise exception 'Ad-hoc PO HSN code required for each size'; end if;
          if po_id is null then
            insert into garments_erp.po_item
              (buyer_po_id, sale_mode_type_id, sellable_product_id, ordered_units, unit_price, product_type_list_id)
            values (shadow_id, (select id from garments_erp.sale_mode_type where type = invoice_mode), variation_id, sets, set_price, po_product_type_id) returning id into po_id;
          else
            update garments_erp.po_item set sellable_product_id = variation_id,
              ordered_units = sets, unit_price = set_price, product_type_list_id = po_product_type_id
            where id = po_id;
          end if;
          insert into garments_erp.po_item_piece_per_size
            (po_item_id, item_size_list_id, pieces_ordered, share_weight, price_per_piece, hsn_code)
          select po_id, size_id, pieces, weight, price, btrim(hsn_by_size->>(size_id::text))
          from jsonb_to_recordset(components) as c(size_id bigint, weight integer, pieces numeric, price numeric)
          on conflict (po_item_id, item_size_list_id) do update
          set pieces_ordered = excluded.pieces_ordered, share_weight = excluded.share_weight,
              price_per_piece = excluded.price_per_piece, hsn_code = excluded.hsn_code;
        end if;
        if line_id is null then
          insert into garments_erp.billing_item (
            billing_id, po_item_id, sale_mode_type_id, sellable_product_id, price_version_id, billed_units, unit_price
          ) values (invoice_id, po_id, (select id from garments_erp.sale_mode_type where type = invoice_mode), variation_id, version_id, sets, set_price) returning id into line_id;
        else
          update garments_erp.billing_item
          set po_item_id = po_id, sellable_product_id = variation_id,
              price_version_id = version_id, billed_units = sets, unit_price = set_price
          where id = line_id;
        end if;
        delete from garments_erp.billing_item_piece_per_size p where p.billing_item_id = line_id
          and not exists (select 1 from jsonb_array_elements(components) part where (part->>'size_id')::bigint = p.item_size_list_id);
        insert into garments_erp.billing_item_piece_per_size
          (billing_item_id, item_size_list_id, share_weight, billed_pieces, price_per_piece)
        select line_id, size_id, case when invoice_mode = 'standard' then weight end, pieces,
               case when invoice_mode = 'exception' then price end
        from jsonb_to_recordset(components) as c(size_id bigint, weight numeric, pieces numeric, price numeric)
        on conflict (billing_item_id, item_size_list_id) do update
        set share_weight = excluded.share_weight, billed_pieces = excluded.billed_pieces,
            price_per_piece = excluded.price_per_piece;

        if shadow_id is not null then
          delete from garments_erp.po_item_piece_per_size p where p.po_item_id = po_id
            and not exists (select 1 from garments_erp.billing_item_piece_per_size b
              where b.billing_item_id = line_id and b.item_size_list_id = p.item_size_list_id);
        end if;

        if exists (
          select 1 from garments_erp.billing_item_piece_per_size p
          join garments_erp.finished_balances(null) s on s.size_id = p.item_size_list_id
          left join public.erp_billing_po_allowance(po_id) po on po.item_size_list_id = p.item_size_list_id
          where p.billing_item_id = line_id and (s.available < 0 or po.remaining is null or po.remaining < 0)
        ) then raise exception 'Insufficient physical stock or PO allowance'; end if;
      end if;
      perform garments_erp.check_billing_packing(invoice_id, false);
    elsif action = 'finalize' and invoice_status = 'draft' then
      if not exists (select 1 from garments_erp.billing_item where billing_id = invoice_id) then
        raise exception 'Cannot finalize an empty invoice';
      end if;
      update garments_erp.billing b set billing_status_type_id = (
        select id from garments_erp.billing_status_type where type = 'finalized'
      ), verified_by = p_employee_id, finalized_at = now(),
      invoice_number = case when p_command ? 'invoice_number' then entered_number else b.invoice_number end,
      gst_percentage = case when p_command ? 'gst_percentage' then entered_gst else b.gst_percentage end
      where b.id = invoice_id;
    elsif action = 'cancel' and invoice_status = 'draft' then
      update garments_erp.billing set billing_status_type_id = (
        select id from garments_erp.billing_status_type where type = 'cancelled'
      ) where id = invoice_id;
      update garments_erp.buyer_po set cancelled_at = now() where id = shadow_id;
    else
      raise exception 'Invalid billing command or status transition';
    end if;
  end if;
  insert into garments_erp.billing_audit (request_id, billing_id, employee_id, command, before_state, after_state)
  values (p_request_id, invoice_id, p_employee_id, p_command, previous, garments_erp.billing_snapshot(invoice_id));
  return invoice_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_dispatch_transport(p_transport_id bigint, p_employee_id bigint, p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  invoice record;
  command jsonb := jsonb_build_object('action', 'dispatch', 'transport_id', p_transport_id);
  prior garments_erp.billing_audit%rowtype;
  dispatched_status bigint;
  old_state jsonb;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Billing commands require read committed isolation';
  end if;
  if p_request_id is null or not exists (
    select 1 from garments_erp.employee_with_status where id = p_employee_id and is_active
  ) then raise exception 'Request ID and active employee required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into prior from garments_erp.billing_audit where request_id = p_request_id;
  if found then
    if (prior.command, prior.employee_id) is distinct from (command, p_employee_id) then
      raise exception 'Request ID already used';
    end if;
    return;
  end if;
  perform 1 from garments_erp.transport
  where id = p_transport_id and dispatched_at is null for update;
  if not found then raise exception 'Transport is missing or already dispatched'; end if;
  if not exists (select 1 from garments_erp.transport_item where transport_id = p_transport_id) then
    raise exception 'Transport requires cartons';
  end if;

  select id into strict dispatched_status from garments_erp.billing_status_type where type = 'dispatched';
  perform b.id from garments_erp.billing b
  where b.id in (
    select pl.billing_id from garments_erp.transport_item ti
    join garments_erp.carton c on c.id = ti.carton_id
    join garments_erp.packing_list pl on pl.id = c.packing_list_id
    where ti.transport_id = p_transport_id
  ) order by b.id for update;

  update garments_erp.transport set dispatched_at = now(), transport_status_type_id = (
    select id from garments_erp.transport_status_type where type = 'dispatched'
  ) where id = p_transport_id;

  for invoice in
    select distinct b.id, st.type
    from garments_erp.transport_item ti
    join garments_erp.carton c on c.id = ti.carton_id
    join garments_erp.packing_list pl on pl.id = c.packing_list_id
    join garments_erp.billing b on b.id = pl.billing_id
    join garments_erp.billing_status_type st on st.id = b.billing_status_type_id
    where ti.transport_id = p_transport_id order by b.id
  loop
    if invoice.type <> 'finalized' then raise exception 'Only finalized invoices can be dispatched'; end if;
    perform garments_erp.check_billing_packing(invoice.id, true);
    old_state := garments_erp.billing_snapshot(invoice.id);
    if not exists (
      select 1 from garments_erp.carton c
      join garments_erp.packing_list pl on pl.id = c.packing_list_id
      left join garments_erp.transport_item ti on ti.carton_id = c.id
      left join garments_erp.transport t on t.id = ti.transport_id
      where pl.billing_id = invoice.id and t.dispatched_at is null
    ) then
      update garments_erp.billing set billing_status_type_id = dispatched_status, dispatched_at = now()
      where id = invoice.id;
    end if;
    insert into garments_erp.billing_audit
      (request_id, billing_id, employee_id, command, before_state, after_state)
    values (p_request_id, invoice.id, p_employee_id, command, old_state, garments_erp.billing_snapshot(invoice.id));
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION garments_erp.guard_finished_catalogue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.legacy_parent is not null then raise exception 'Legacy provenance is migration-managed'; end if;
  elsif tg_op = 'UPDATE' then
    if new.legacy_parent is distinct from old.legacy_parent then
      raise exception 'Legacy provenance is immutable';
    end if;
  end if;
  if tg_op = 'DELETE' then
    if old.verified_by_employee_id is not null then raise exception 'Retire verified configurations instead'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if not old.is_active and new.is_active then raise exception 'Retirement is permanent'; end if;
    if old.verified_by_employee_id is not null then
      if (to_jsonb(new) - array['name', 'is_active', 'updated_at'])
          is distinct from (to_jsonb(old) - array['name', 'is_active', 'updated_at']) then
        raise exception 'Verified commercial configurations are immutable';
      end if;
      return new;
    end if;
  end if;
  if new.verified_by_employee_id is not null then
    if not exists (select 1 from garments_erp.employee_with_status e where e.id = new.verified_by_employee_id and e.is_active)
    then raise exception 'Select an active employee'; end if;
      if not exists (select 1 from garments_erp.sellable_unit u where u.sellable_product_id = new.id)
         or exists (
           select 1 from garments_erp.sellable_unit u where u.sellable_product_id = new.id
           and not exists (select 1 from garments_erp.item_produced p where p.item_id = u.item_id)
         ) then raise exception 'Each component item needs verified finished stock-in'; end if;
      new.verified_at := now();
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION garments_erp.create_finished_stock(p_item_id bigint, p_job_id bigint, p_employee_id bigint, p_pieces jsonb, p_request_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  receipt_id bigint;
  prior garments_erp.item_produced%rowtype;
  saved_pieces jsonb;
begin
  if not garments_access.has_screen_permission('finishedProducts', 'create') then
    raise exception 'Finished Products create access required' using errcode = '42501';
  end if;
  if p_request_id is null or jsonb_typeof(p_pieces) is distinct from 'object'
     or p_pieces = '{}'::jsonb then raise exception 'A request ID and size quantities are required'; end if;
  perform 1 from garments_erp.item where id = p_item_id for update;
  if not found then raise exception 'Manufactured item not found'; end if;
  select * into prior from garments_erp.item_produced where request_id = p_request_id;
  if found then
    select jsonb_object_agg(item_size_list_id::text, pieces) into saved_pieces
    from garments_erp.item_produced_pieces where item_produced_id = prior.id;
    if (prior.item_id, prior.completed_job_id, prior.verified_by, saved_pieces)
      is distinct from (p_item_id, p_job_id, p_employee_id, p_pieces) then
      raise exception 'Request ID already used with different stock-in details';
    end if;
    return prior.id::text;
  end if;
  if not exists (select 1 from garments_erp.employee_with_status where id = p_employee_id and is_active)
  then raise exception 'Select an active employee'; end if;
  perform p.id from garments_erp.item_part ip join garments_erp.production p on p.item_part_id = ip.id
    where ip.item_id = p_item_id order by p.id for update of p;
  if not exists (
    select 1 from garments_erp.item_part ip join garments_erp.production p on p.item_part_id = ip.id
    join garments_erp.job j on j.production_id = p.id and j.latest
    where ip.item_id = p_item_id and j.id = p_job_id
  ) or exists (
    select 1 from garments_erp.item_part ip
    where ip.item_id = p_item_id and not exists (
      select 1 from garments_erp.production p
      join garments_erp.job j on j.production_id = p.id and j.latest
      join garments_erp.stage s on s.id = j.stage_id
      join garments_erp.stage_type st on st.id = s.stage_type_id
      where p.item_part_id = ip.id and lower(st.name) = 'complete'
    )
  ) then raise exception 'Every item part must have a current completed job'; end if;

  perform z.id from garments_erp.size_list z join garments_erp.item_size_list s on s.size_list_id = z.id
    where s.item_id = p_item_id order by z.id for update of z;
  if exists (
    select 1 from jsonb_each(p_pieces) q
    left join garments_erp.item_size_list s on s.id::text = q.key and s.item_id = p_item_id
    where s.id is null or case when jsonb_typeof(q.value) = 'number' then
      q.value::numeric < 0 or q.value::numeric > 2147483647 or q.value::numeric <> trunc(q.value::numeric)
      else true end
  ) or not exists (select 1 from jsonb_each(p_pieces) q where q.value > '0'::jsonb)
  then raise exception 'Enter valid whole quantities for this item, including at least one positive quantity'; end if;

  insert into garments_erp.item_produced (item_id, completed_job_id, verified_by, request_id)
  values (p_item_id, p_job_id, p_employee_id, p_request_id) returning id into receipt_id;
  insert into garments_erp.item_produced_pieces (item_produced_id, item_size_list_id, pieces)
  select receipt_id, q.key::bigint, q.value::numeric::integer from jsonb_each(p_pieces) q;
  update garments_erp.item set is_locked = true where id = p_item_id and not is_locked;
  return receipt_id::text;
end;
$function$;

CREATE OR REPLACE FUNCTION garments_erp.adjust_finished_stock(p_item_id bigint, p_size_id bigint, p_delta numeric, p_reason text, p_employee_id bigint, p_request_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  adjustment_id bigint;
  prior garments_erp.stock_adjustment%rowtype;
  balance bigint;
begin
  if not garments_access.has_screen_permission('finishedProducts', 'create') then
    raise exception 'Finished Products create access required' using errcode = '42501';
  end if;
  if p_request_id is null or p_delta is null or p_delta < -2147483648 or p_delta > 2147483647
     or p_delta <> trunc(p_delta) or nullif(btrim(p_reason), '') is null
  then raise exception 'Provide a signed whole quantity, reason and request ID'; end if;
  perform 1 from garments_erp.item where id = p_item_id and is_locked for update;
  if not found then raise exception 'Verified finished stock-in is required'; end if;
  select * into prior from garments_erp.stock_adjustment where request_id = p_request_id;
  if found then
    if (prior.item_id, prior.item_size_list_id, prior.quantity_delta, prior.reason, prior.verified_by)
      is distinct from (p_item_id, p_size_id, p_delta, btrim(p_reason), p_employee_id) then
      raise exception 'Request ID already used with different adjustment details';
    end if;
    return prior.id::text;
  end if;
  if not exists (select 1 from garments_erp.employee_with_status where id = p_employee_id and is_active)
  then raise exception 'Select an active employee'; end if;
  select b.available into balance from garments_erp.finished_balances(p_item_id) b where b.size_id = p_size_id;
  if not found then raise exception 'Size does not belong to the manufactured item'; end if;
  if balance + p_delta < 0 then raise exception 'Adjustment would make stock negative'; end if;
  insert into garments_erp.stock_adjustment (item_id, item_size_list_id, quantity_delta, reason, verified_by, request_id)
  values (p_item_id, p_size_id, p_delta::integer, btrim(p_reason), p_employee_id, p_request_id)
  returning id into adjustment_id;
  return adjustment_id::text;
end;
$function$;

CREATE OR REPLACE FUNCTION garments_erp.employee_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if not garments_access.has_screen_permission('employees','view') then raise exception 'Employee access required' using errcode='42501';end if;
 result:=jsonb_build_object('records',(select coalesce(jsonb_agg(garments_erp.employee_document(e.id)||jsonb_build_object('revision',md5(garments_erp.employee_document(e.id)::text)) order by e.id),'[]') from garments_erp.employee_with_status e),
 'contact_choices',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id::text,'company_name',c.company_name) order by c.id),'[]') from garments_erp.contacts c),
 'verifiers',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'name',c.company_name,'code',e.employee_code,'email',a.email)),'[]') from garments_erp.employee_with_status e join garments_access.app_user u on u.employee_id=e.id and u.is_active and not u.must_change_password join auth.users a on a.id=u.user_id join garments_erp.contacts c on c.id=e.contacts_id where a.email is not null and e.is_active and u.user_id=auth.uid()));
 result:=result||jsonb_build_object(
 'gender',(select coalesce(jsonb_agg(garments_erp.fabric_json('gender',to_jsonb(x)) order by x.id),'[]'::jsonb) from garments_erp.gender x),
 'blood_group',(select coalesce(jsonb_agg(garments_erp.fabric_json('blood_group',to_jsonb(x)) order by x.id),'[]'::jsonb) from garments_erp.blood_group x),
 'type_of_employment',(select coalesce(jsonb_agg(garments_erp.fabric_json('type_of_employment',to_jsonb(x)) order by x.id),'[]'::jsonb) from garments_erp.type_of_employment x),
 'contact_purpose',(select coalesce(jsonb_agg(garments_erp.fabric_json('contact_purpose',to_jsonb(x)) order by x.id),'[]'::jsonb) from garments_erp.contact_purpose x));
 return result;
end $function$;

CREATE OR REPLACE FUNCTION garments_erp.save_production_board(p_id bigint, p_expected text, p_assignees bigint[], p_flags bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare bid bigint;
begin
 if not garments_access.has_screen_permission('productionJobs','edit') then raise exception 'Production write access required' using errcode='42501';end if;
 perform 1 from garments_erp.production where id=p_id for update;
 if not found or md5(garments_erp.production_document(p_id)::text) is distinct from p_expected
   then raise exception 'Production changed. Reload before saving.' using errcode='40001';end if;
 if p_assignees is null or p_flags is null or cardinality(p_assignees)>100 or cardinality(p_flags)>100
   or exists(select 1 from unnest(p_assignees) x where x is null or not exists(select 1 from garments_erp.employee_with_status where id=x and is_active))
   then raise exception 'Select active employees and valid flags';end if;
 select id into strict bid from garments_erp.task_board_data where production_id=p_id;
 delete from garments_erp.job_assignees where production_id=p_id and not assigned_employees_id=any(p_assignees);
 insert into garments_erp.job_assignees(production_id,assigned_employees_id)
 select distinct p_id,x from unnest(p_assignees) x on conflict(production_id,assigned_employees_id) do nothing;
 delete from garments_erp.task_board_data_flag where task_board_data_id=bid and not task_board_data_flag_id=any(p_flags);
 insert into garments_erp.task_board_data_flag(task_board_data_id,task_board_data_flag_id)
 select distinct bid,x from unnest(p_flags) x on conflict(task_board_data_id,task_board_data_flag_id) do nothing;
 return garments_erp.production_snapshot();
end $function$;

CREATE OR REPLACE FUNCTION public.erp_finished_goods_choices(p_adjustment boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not garments_access.has_screen_permission('finishedProducts', 'create') then
    raise exception 'Finished Products create access required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id::text, 'label', e.employee_code) order by e.employee_code)
      from garments_erp.employee_with_status e where e.is_active
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id::text, 'label', coalesce(i.style_code, i.id::text),
        'costing_finalized', exists (
          select 1 from garments_erp.item_costing c
          join garments_erp.item_costing_status s on s.id = c.item_costing_status_id
          where c.item_id = i.id and s.name = 'finalized'
        ),
        'sizes', coalesce((
          select jsonb_agg(jsonb_build_object('id', sz.id::text, 'label', sl.size) order by sl.sort_order, sz.id)
          from garments_erp.item_size_list sz join garments_erp.size_list sl on sl.id = sz.size_list_id
          where sz.item_id = i.id
        ), '[]'::jsonb),
        'jobs', coalesce((
          select jsonb_agg(jsonb_build_object('id', j.id::text, 'label', coalesce(j.job_code, j.id::text)) order by j.id)
          from garments_erp.item_part ip
          join garments_erp.production p on p.item_part_id = ip.id
          join garments_erp.job j on j.production_id = p.id and j.latest
          join garments_erp.stage st on st.id = j.stage_id
          join garments_erp.stage_type typ on typ.id = st.stage_type_id
          where ip.item_id = i.id and lower(typ.name) = 'complete'
        ), '[]'::jsonb)
      ) order by i.style_code, i.id)
      from garments_erp.item i
      where case when p_adjustment then
        exists (select 1 from garments_erp.item_produced r where r.item_id = i.id)
      else exists (select 1 from garments_erp.costing_ready_items() ready where ready.id = i.id)
        and not exists (select 1 from garments_erp.item_produced r where r.item_id = i.id)
      end
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_finished_goods_catalogue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not garments_access.has_screen_permission('finishedProducts', 'view') then
    raise exception 'Finished Goods view access required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id::text, 'sku', p.sku, 'name', p.name,
        'active', p.is_active, 'verified', p.verified_at is not null,
        'components', coalesce((
          select jsonb_agg(jsonb_build_object('id', u.id::text, 'item', i.style_code,
            'size', sl.size, 'pieces', u.share_weight, 'reference_cost', costing.final_unit_cost)
            order by i.style_code, sl.sort_order, u.id)
          from garments_erp.sellable_unit u
          join garments_erp.item i on i.id = u.item_id
          join garments_erp.item_size_list sz on sz.id = u.item_size_list_id
          join garments_erp.size_list sl on sl.id = sz.size_list_id
          left join lateral (
            select summary.final_unit_cost
            from garments_erp.item_costing_summary summary
            join garments_erp.item_costing header on header.id = summary.id
            join garments_erp.item_costing_status status on status.id = summary.item_costing_status_id
            where summary.item_id = i.id and header.item_produced_id is not null
              and status.name = 'finalized'
            order by summary.version desc limit 1
          ) costing on true
          where u.sellable_product_id = p.id
        ), '[]'::jsonb)) order by p.sku, p.id)
      from garments_erp.sellable_product p
    ), '[]'::jsonb),
    'prices', coalesce((
      select jsonb_agg(jsonb_build_object('id', price.id::text, 'product', product.sku,
        'type', t.name, 'version', price.version, 'price_per_piece', price.price_per_piece,
        'date', price.date) order by price.date desc nulls last, price.id desc)
      from garments_erp.item_in_store_price price
      join garments_erp.sellable_product product on product.id = price.sellable_product_id
      join garments_erp.price_type t on t.id = price.price_type_id
    ), '[]'::jsonb),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object('id', id::text, 'name', name,
        'description', description) order by name, id)
      from garments_erp.price_type
    ), '[]'::jsonb),
    'sizes', coalesce((
      select jsonb_agg(jsonb_build_object('id', sz.id::text, 'item', i.style_code,
        'size', sl.size) order by i.style_code, sl.sort_order, sz.id)
      from garments_erp.item_size_list sz
      join garments_erp.item i on i.id = sz.item_id
      join garments_erp.size_list sl on sl.id = sz.size_list_id
      where exists (select 1 from garments_erp.item_produced receipt where receipt.item_id = i.id)
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object('id', id::text, 'label', employee_code) order by employee_code)
      from garments_erp.employee_with_status
      where is_active and garments_access.has_screen_permission('finishedProducts', 'create')
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION garments_erp.challan_documents(p_billing boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare resource text := case when p_billing then 'jobWorkerBills' else 'productionChallans' end;
begin
  if not garments_access.has_screen_permission(resource,'view') then
    raise exception 'Document access required' using errcode='42501';
  end if;
  return (
    with assignments as (
      select a.id::text id,j.job_code job,j.job_worker_id::text worker,
             coalesce(c.company_name,'Worker '||j.job_worker_id) worker_name,
             i.style_code style,p.part part,v.variant_name variant,s.name stage,
             coalesce((select jsonb_object_agg(z.size,sp.pieces_stock_in::text)
               from garments_erp.stage_pieces sp
               join garments_erp.item_size_list iz on iz.id=sp.item_size_list_id
               join garments_erp.size_list z on z.id=iz.size_list_id
               where sp.variant_item_per_job_id=a.id),'{}') stock
      from garments_erp.variant_item_per_job a
      join garments_erp.job j on j.id=a.job_id
      join garments_erp.stage s on s.id=j.stage_id
      left join garments_erp.job_worker w on w.id=j.job_worker_id
      left join garments_erp.contacts c on c.id=w.contacts_id
      join garments_erp.variant_item vi on vi.id=a.variant_item_id
      join garments_erp.variant v on v.id=vi.variant_id
      join garments_erp.item_part ip on ip.id=vi.item_part_id
      join garments_erp.part_list p on p.id=ip.part_list_id
      join garments_erp.item i on i.id=ip.item_id
    ), lines as (
      select l.id::text id,l.challan_id,l.variant_item_per_job_id::text assignment,
        l.rate::text rate,l.description,
        exists(select 1 from garments_erp.job_worker_bill_items b where b.challan_job_item_id=l.id) billed,
        coalesce((select jsonb_object_agg(z.size, q.issued_pieces::text)
          from garments_erp.challan_job_item_pieces q
          join garments_erp.item_size_list iz on iz.id=q.item_size_list_id
          join garments_erp.size_list z on z.id=iz.size_list_id where q.challan_job_item_id=l.id),'{}') quantities
      from garments_erp.challan_job_item l
    )
    select jsonb_build_object(
      'permissions', (select jsonb_object_agg(action,garments_access.has_screen_permission(resource,action))
        from unnest(array['create','edit','delete','print','format','export']) action),
      'pages',jsonb_build_object('challans',garments_access.has_screen_permission('productionChallans','view'),
        'billing',garments_access.has_screen_permission('jobWorkerBills','view')),
      'sizeOrder',(select coalesce(jsonb_agg(z.size order by z.sort_order,z.id),'[]')
        from garments_erp.size_list z),
      'assignments',(select coalesce(jsonb_agg(to_jsonb(a) order by a.style,a.part,a.variant,a.id),'[]')
        from assignments a where (not p_billing and a.worker is not null and a.stock<>'{}') or exists(select 1 from lines l where l.assignment=a.id)),
      'employees',case when p_billing then '[]'::jsonb else
        (select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'name',coalesce(c.company_name,e.employee_code)) order by c.company_name,e.id),'[]')
         from garments_erp.employee_with_status e left join garments_erp.contacts c on c.id=e.contacts_id
         where e.is_active or exists(select 1 from garments_erp.challan ch where ch.issue_employee_id=e.id)) end,
      'challans',(select coalesce(jsonb_agg(jsonb_build_object('key',ch.id::text,'id',ch.challan_number,'date',ch.issue_date,
         'revision',ch.updated_at,'employee',case when not p_billing then ch.issue_employee_id::text end,
         'lines',(select coalesce(jsonb_agg(to_jsonb(l)-'challan_id' order by l.id::bigint),'[]') from lines l where l.challan_id=ch.id)) order by ch.id desc),'[]')
         from garments_erp.challan ch),
      'bills',case when p_billing then (select coalesce(jsonb_agg(jsonb_build_object('key',b.id::text,'number','WB-'||b.id,
        'invoiceNumber',b.invoice_number,'date',b.date,'revision',b.updated_at,
        'attachment',case when f.id is not null then jsonb_build_object('id',f.id::text,'name',f.filename) end,
        'items',(select coalesce(jsonb_agg(jsonb_build_object('line',bi.challan_job_item_id::text,'rate',bi.billed_rate::text) order by bi.id),'[]')
          from garments_erp.job_worker_bill_items bi where bi.job_worker_bill_id=b.id)) order by b.id desc),'[]')
        from garments_erp.job_worker_bill b left join garments_erp.attachments f on f.id=b.bill_attachment) else '[]'::jsonb end
    )
  );
end $function$;

CREATE OR REPLACE FUNCTION public.erp_verify_billing_return(p_request_id uuid, p_billing_id bigint, p_employee_id bigint, p_lines jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result_id bigint;
  line_id bigint;
  line jsonb;
  original garments_erp.billing_item%rowtype;
  units numeric;
  mode text;
  previous garments_erp.billing_audit%rowtype;
  return_command jsonb := jsonb_build_object('action', 'return', 'billing_id', p_billing_id, 'lines', p_lines);
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Billing commands require read committed isolation';
  end if;
  if p_request_id is null or not exists (
    select 1 from garments_erp.employee_with_status where id = p_employee_id and is_active
  ) then raise exception 'Request ID and active employee required'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or p_lines = '[]'::jsonb then
    raise exception 'Return requires billed size components';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into previous from garments_erp.billing_audit where request_id = p_request_id;
  if found then
    if (previous.command, previous.employee_id) is distinct from (return_command, p_employee_id) then
      raise exception 'Request ID already used';
    end if;
    return (previous.after_state->>'return_id')::bigint;
  end if;
  perform 1 from garments_erp.billing b
  join garments_erp.billing_status_type st on st.id = b.billing_status_type_id
  where b.id = p_billing_id and st.type = 'dispatched' for update of b;
  if not found then raise exception 'Returns require a dispatched invoice'; end if;
  perform i.id from garments_erp.item i where i.id in (
    select s.item_id from garments_erp.item_size_list s
    join garments_erp.billing_item_piece_per_size bp on bp.item_size_list_id = s.id
    join garments_erp.billing_item l on l.id = bp.billing_item_id
    where l.billing_id = p_billing_id
  ) order by i.id for update;
  insert into garments_erp.return_bill (billing_id, date, verified_by_id, verified_at)
  values (p_billing_id, current_date, p_employee_id, now()) returning id into result_id;
  for line in select value from jsonb_array_elements(p_lines)
  loop
    mode := coalesce(line->>'mode', 'piece');
    units := (line->>'returned_units')::numeric;
    select bi.* into strict original
    from garments_erp.billing_item bi
    where bi.billing_id = p_billing_id and bi.id = coalesce(
      (line->>'billing_item_id')::bigint,
      (select billing_item_id from garments_erp.billing_item_piece_per_size
       where id = (line->>'billed_piece_id')::bigint));

    if mode = 'set' then
      if units is null or units <> trunc(units) or units < 1
         or original.billed_units is null or units > original.billed_units
         or original.sellable_product_id is null
         or not exists (select 1 from garments_erp.billing_item_piece_per_size where billing_item_id = original.id)
         or exists (select 1 from garments_erp.billing_item_piece_per_size
                    where billing_item_id = original.id and
                    (share_weight is null or share_weight <= 0 or billed_pieces <> share_weight::bigint * original.billed_units))
      then raise exception 'Set return requires whole sets and a valid frozen composition'; end if;
    elsif mode <> 'piece' or units is not null then
      raise exception 'Invalid return mode or quantity';
    end if;

    insert into garments_erp.return_bill_item
      (return_bill_id, billing_item_id, return_mode_type_id, return_reason_type_id,
       returned_units, unit_price, sellable_product_id)
    values (result_id, original.id, (select id from garments_erp.return_mode_type where type = mode),
      (line->>'reason_id')::bigint, units::integer, (line->>'unit_price')::numeric,
      case when mode = 'set' then original.sellable_product_id end)
    returning id into line_id;

    if mode = 'set' then
      insert into garments_erp.return_bill_item_piece_per_size
        (return_bill_item_id, billing_item_piece_per_size_id, item_size_list_id, share_weight, returned_pieces)
      select line_id, id, item_size_list_id, share_weight, (share_weight * units)::integer
      from garments_erp.billing_item_piece_per_size where billing_item_id = original.id;
    else
      insert into garments_erp.return_bill_item_piece_per_size
        (return_bill_item_id, billing_item_piece_per_size_id, item_size_list_id, returned_pieces, returned_price_per_piece)
      select line_id, bp.id, bp.item_size_list_id,
        case when part.pieces = trunc(part.pieces) then part.pieces::integer end, part.price
      from jsonb_to_recordset(coalesce(line->'pieces_by_size', jsonb_build_array(line)))
        as part(billed_piece_id bigint, pieces numeric, price numeric)
      left join garments_erp.billing_item_piece_per_size bp
        on bp.id = part.billed_piece_id and bp.billing_item_id = original.id;
      if not found then raise exception 'Piece return requires billed size components'; end if;
    end if;
  end loop;

  if exists (
    select 1
    from garments_erp.return_bill_item_piece_per_size part
    join garments_erp.return_bill_item ri on ri.id = part.return_bill_item_id
    join garments_erp.return_bill rb on rb.id = ri.return_bill_id
    join garments_erp.billing_item_piece_per_size bp on bp.id = part.billing_item_piece_per_size_id
    where rb.billing_id = p_billing_id and rb.verified_at is not null
    group by bp.id, bp.billed_pieces
    having sum(part.returned_pieces) > bp.billed_pieces
  ) then raise exception 'Cumulative return exceeds dispatched pieces'; end if;
  if exists (
    select 1 from garments_erp.return_bill_item ri
    join garments_erp.billing_item bi on bi.id = ri.billing_item_id
    left join garments_erp.return_bill_item_piece_per_size part on part.return_bill_item_id = ri.id
    left join garments_erp.billing_item_piece_per_size bp on bp.id = part.billing_item_piece_per_size_id
    where ri.return_bill_id = result_id and
      coalesce(part.returned_price_per_piece, ri.unit_price) > coalesce(bi.unit_price, bp.price_per_piece)
  ) then raise exception 'Return price exceeds the original billed unit price'; end if;

  if exists (
    select 1 from garments_erp.billing_value(p_billing_id) v
    where v.verified_credit > v.original_value
  ) then raise exception 'Cumulative return credit exceeds original billed value'; end if;

  insert into garments_erp.billing_audit (request_id, billing_id, employee_id, command, after_state)
  values (p_request_id, p_billing_id, p_employee_id, return_command, jsonb_build_object('return_id', result_id));
  return result_id;
end;
$function$;

CREATE OR REPLACE FUNCTION garments_erp.billing_employee(p_screen text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  actor bigint;
begin
  if not garments_access.has_screen_permission(p_screen, 'view') then
    raise exception 'Billing page access required' using errcode = '42501';
  end if;
  select e.id into actor
  from garments_access.app_user u
  join garments_erp.employee_with_status e on e.id = u.employee_id
  where u.user_id = auth.uid() and u.is_active and e.is_active;
  if actor is null then
    raise exception 'An active linked employee is required' using errcode = '42501';
  end if;
  return actor;
end;
$function$;

CREATE OR REPLACE FUNCTION garments_access.has_eligible_administrator()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(
  select 1 from garments_access.app_user u
  join garments_erp.employee_with_status e on e.id=u.employee_id and e.is_active
  join garments_access.app_user_role ur on ur.user_id=u.user_id
  join garments_access.app_role r on r.id=ur.role_id
  where u.is_active and not u.must_change_password and r.is_active and r.is_system_admin
   and exists(select 1 from auth.mfa_factors f where f.user_id=u.user_id
      and f.factor_type='totp' and f.status='verified')
 );
$function$;

CREATE OR REPLACE FUNCTION garments_access.employee_invitation_command(p_action text, p_employee_id bigint, p_email text DEFAULT NULL::text, p_role_ids bigint[] DEFAULT NULL::bigint[], p_revision uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 pending garments_access.employee_invitation;
 linked garments_access.app_user;
 destination text;
 email_input text := lower(trim(p_email));
 requested_roles bigint[];
begin
 perform pg_advisory_xact_lock(71426,1);
 perform garments_access.require_administrator();
 if p_action<>'cancel' and not exists(select 1 from garments_erp.employee_with_status where id=p_employee_id and is_active) then
  raise exception 'Choose an active employee';
 end if;
 select * into pending from garments_access.employee_invitation where employee_id=p_employee_id for update;
 select * into linked from garments_access.app_user where employee_id=p_employee_id;
 if p_action in ('retry','finish','cancel','correct') and p_revision is null then
  raise exception 'Refresh User Access before changing the invitation';
 end if;
 if p_revision is not null and pending.revision is distinct from p_revision then
  raise exception 'The invitation changed. Refresh User Access';
 end if;
 if p_action in ('cancel','correct') then
  if linked.user_id is not null or pending.employee_id is null then
   raise exception 'Only an incomplete invitation can be cancelled or corrected';
  end if;
  if p_action='correct' and email_input is not distinct from pending.email then
   raise exception 'Choose a different email address';
  end if;
  insert into garments_access.cancelled_employee_invitation(nonce,user_id)
  values(pending.nonce,pending.user_id);
  delete from garments_access.employee_invitation where employee_id=p_employee_id;
  insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details)
  values(auth.uid(),case when p_action='correct' then 'Corrected employee invitation email'
    else 'Cancelled employee invitation' end,'employee',p_employee_id::text,
    jsonb_build_object('old_email',pending.email,'new_email',case when p_action='correct' then email_input end));
  if p_action='cancel' then return jsonb_build_object('state','cancelled'); end if;
 end if;
 if p_action='resend' then
  if not linked.is_active or linked.user_id is null then raise exception 'Invitation is unavailable'; end if;
  select email into destination from auth.users where id=linked.user_id and invited_at is not null
   and email_confirmed_at is null and coalesce(encrypted_password,'')='';
  if destination is null then raise exception 'Invitation is unavailable'; end if;
  if exists(select 1 from garments_access.app_activity_log
   where target_type='employee' and target_id=p_employee_id::text
    and action in ('Requested employee invitation','Requested invitation resend')
    and created_at>now()-interval '60 seconds') then
   raise exception 'Wait a minute before resending';
  end if;
 elsif p_action in ('invite','correct','retry','finish') then
  if linked.user_id is not null then
   if p_action='invite' or pending.user_id is distinct from linked.user_id then
    raise exception 'Employee already has a login account';
   end if;
   -- Release the email reservation after linking so a future verified email
   -- change does not block a different employee from using the old address.
   update garments_access.employee_invitation set email=null where employee_id=p_employee_id and email is not null;
   return jsonb_build_object('state','linked');
  end if;
  if p_action in ('invite','correct') then
   select array_agg(distinct r order by r) into requested_roles
   from unnest(case when p_action='correct' then pending.role_ids else p_role_ids end) r;
   if email_input is null or length(email_input)>254 or email_input !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or requested_roles is null or exists(select 1 from unnest(requested_roles) r
       where not exists(select 1 from garments_access.app_role where id=r and is_active)) then
    raise exception 'Choose a valid email and active roles';
   end if;
   if p_action='invite' and pending.employee_id is not null then raise exception 'Use Retry provisioning for this employee'; end if;
   if exists(select 1 from auth.users where lower(email)=email_input) then
    raise exception 'An Auth identity already exists for this email';
   end if;
   insert into garments_access.employee_invitation(employee_id,email,role_ids)
   values(p_employee_id,email_input,requested_roles) returning * into pending;
  end if;
  if pending.employee_id is null then raise exception 'No invitation to retry'; end if;
  if pending.user_id is not null then
   perform garments_access.save_account_access(pending.user_id,p_employee_id,pending.role_ids,true,null);
   update garments_access.employee_invitation set email=null where employee_id=p_employee_id;
   return jsonb_build_object('state','linked');
  end if;
  if p_action='finish' then raise exception 'Auth invitation has not been recorded'; end if;
  if exists(select 1 from auth.users where lower(email)=pending.email) then
   raise exception 'An unrelated Auth identity already uses this email';
  end if;
  if exists(select 1 from unnest(pending.role_ids) r
     where not exists(select 1 from garments_access.app_role where id=r and is_active)) then
   raise exception 'A selected role is no longer available';
  end if;
  if pending.last_attempt_at > now()-interval '60 seconds' then
   raise exception 'Wait a minute before retrying';
  end if;
  update garments_access.employee_invitation set last_attempt_at=now() where employee_id=p_employee_id;
  destination := pending.email;
 else
  raise exception 'Unknown invitation action';
 end if;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id)
 values(auth.uid(),case p_action when 'resend' then 'Requested invitation resend' else 'Requested employee invitation' end,
  'employee',p_employee_id::text);
 return jsonb_build_object('state','send','email',destination,'revision',pending.revision,
  'nonce',case when p_action<>'resend' then pending.nonce end);
end $function$;

CREATE OR REPLACE FUNCTION garments_access.complete_native_password_setup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare account garments_access.app_user;
begin
 select * into account from garments_access.app_user where user_id = new.id for update;
 if not found then return new; end if;
 if not account.is_active or not exists(
  select 1 from garments_erp.employee_with_status e where e.id = account.employee_id and e.is_active
 ) then
  raise exception 'ERP account disabled' using errcode = '42501';
 end if;
 if new.email_confirmed_at is not null and coalesce(new.encrypted_password, '') <> ''
    and account.must_change_password then
  update garments_access.app_user set must_change_password = false, version = version + 1
  where user_id = new.id;
  insert into garments_access.app_activity_log(actor_user_id, action, target_type, target_id)
  values (new.id, 'Completed password setup', 'app_user', new.id::text);
 end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION garments_access.sync_verified_employee_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pending garments_access.pending_employee_email;
  contact bigint;
  desired text;
  completed boolean := old.email is distinct from new.email;
begin
  -- Password and other Auth changes can include unchanged email fields.
  if not completed and (new.email_change is not distinct from old.email_change
                       or nullif(new.email_change, '') is null) then return new; end if;
  if not exists(select 1 from garments_access.app_user where user_id = old.id) then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(71426,1);
  select e.contacts_id into contact
  from garments_access.app_user u
  join garments_erp.employee_with_status e on e.id = u.employee_id and e.is_active
  where u.user_id = old.id and u.is_active and not u.must_change_password;
  select * into pending from garments_access.pending_employee_email where user_id = old.id for update;
  desired := lower(case when completed then new.email else new.email_change end);
  if contact is null or pending.user_id is null or pending.contact_id <> contact
     or pending.old_email is distinct from old.email
     or pending.new_email is distinct from desired or pending.expires_at <= now()
     or not exists(select 1 from auth.sessions s where s.id = pending.session_id
          and s.user_id = old.id and s.aal = 'aal2' and (s.not_after is null or s.not_after > now()))
     or not exists(select 1 from auth.mfa_factors f where f.user_id = old.id
          and f.factor_type = 'totp' and f.status = 'verified') then
    raise exception 'Start a new email change from a verified ERP session' using errcode = '42501';
  end if;
  if not completed then return new; end if;
  if lower(old.email_change) is distinct from desired then
    raise exception 'Verify the new email through Supabase Auth' using errcode = '42501';
  end if;
  if exists(
    select 1 from garments_access.app_user u join garments_erp.employee_with_status e on e.id = u.employee_id
    where e.contacts_id = contact and u.user_id <> old.id
  ) then
    raise exception 'This contact is linked to another ERP account' using errcode = '42501';
  end if;

  update garments_erp.contact_items set email = new.email, updated_at = now()
    where contact_id = contact and primary_email;
  if not found then
    insert into garments_erp.contact_items(contact_id, email, primary_email)
    values (contact, new.email, true);
  end if;
  insert into garments_access.app_activity_log(actor_user_id, action, target_type, target_id, details)
  values (old.id, 'Changed login email', 'app_user', old.id::text,
          jsonb_build_object('old_email', old.email, 'new_email', new.email,
                             'contact_id', contact, 'completed_at', now()));
  delete from garments_access.pending_employee_email where user_id = old.id;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION garments_access.change_account_lifecycle(p_action text, p_user_id uuid, p_employee_id bigint, p_expected_version bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 account garments_access.app_user;
 assigned_roles bigint[];
begin
 perform pg_advisory_xact_lock(71426,1);
 perform garments_access.require_administrator();
 if p_action is null or p_action not in ('deactivate','reactivate','remove') then
  raise exception 'Unknown account action';
 end if;
 if p_user_id = auth.uid() then
  raise exception 'Ask another Administrator to change your access';
 end if;
 -- Password setup locks Auth before the ERP link. Use the same lock order.
 perform 1 from auth.users where id=p_user_id for update;
 select * into account from garments_access.app_user where user_id=p_user_id for update;
 if not found or account.employee_id is distinct from p_employee_id
  or account.version is distinct from p_expected_version then
  raise exception 'Account changed. Refresh User Access before confirming' using errcode='40001';
 end if;

 if p_action <> 'remove' then
  if account.is_active = (p_action = 'reactivate') then
   raise exception 'Account status already changed. Refresh User Access before confirming' using errcode='40001';
  end if;
  -- Preserve role assignments, including their original authors and dates.
  if p_action = 'reactivate' and (
   not exists(select 1 from garments_erp.employee_with_status where id=p_employee_id and is_active)
   or not exists(
    select 1 from garments_access.app_user_role ur join garments_access.app_role r on r.id=ur.role_id
    where ur.user_id=p_user_id and r.is_active
   )
  ) then
   raise exception 'Reactivation requires an active employee and an active role';
  end if;
  update garments_access.app_user set is_active=(p_action='reactivate'), version=version+1
  where user_id=p_user_id;
  if p_action='deactivate' then
   update auth.users set banned_until='9999-01-01 00:00:00+00', updated_at=now() where id=p_user_id;
   delete from auth.sessions where user_id=p_user_id;
   delete from auth.refresh_tokens where user_id=p_user_id::text;
   delete from auth.one_time_tokens where user_id=p_user_id;
  else
   update auth.users set banned_until=null, updated_at=now()
   where id=p_user_id and banned_until='9999-01-01 00:00:00+00';
  end if;
 else
  select array_agg(role_id order by role_id) into assigned_roles
  from garments_access.app_user_role where user_id=p_user_id;

  -- Keep the original Auth UUID as an immutable reference for audit records,
  -- employee attribution, transactions and storage ownership.
  insert into garments_access.cancelled_employee_invitation(nonce,user_id)
  select coalesce(
   (select nonce from garments_access.employee_invitation where user_id=p_user_id),
   gen_random_uuid()
  ), p_user_id;
  delete from garments_access.employee_invitation where user_id=p_user_id;
  delete from garments_access.app_user_role where user_id=p_user_id;
  delete from garments_access.app_user where user_id=p_user_id;

  perform garments_access.retire_auth_identity(p_user_id);
 end if;

 if not garments_access.has_eligible_administrator() then
  raise exception 'Keep at least one active Administrator with completed setup';
 end if;
 insert into garments_access.app_activity_log(actor_user_id,app_resource_id,action,target_type,target_id,details)
 select auth.uid(),id,
  case p_action when 'deactivate' then 'Deactivated access'
   when 'reactivate' then 'Reactivated access' else 'Removed access' end,
  'app_user',p_user_id::text,jsonb_build_object('employee_id',p_employee_id,'removed_role_ids',assigned_roles)
 from garments_access.app_resource where key='adminAccess';
end;
$function$;

notify pgrst, 'reload schema';
commit;
