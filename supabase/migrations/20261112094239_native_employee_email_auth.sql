begin;

-- A new invitation must finish password setup before the ERP accepts AAL2.
create function garments_access.flag_invited_password_setup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if exists (select 1 from auth.users a where a.id = new.user_id
            and a.invited_at is not null and coalesce(a.encrypted_password, '') = '') then
  new.must_change_password := true;
 end if;
 return new;
end;
$$;
revoke all on function garments_access.flag_invited_password_setup() from public, anon, authenticated;
create trigger flag_invited_password_setup
before insert on garments_access.app_user for each row
execute function garments_access.flag_invited_password_setup();

-- Record setup completion in the same transaction as Supabase's password write.
create function garments_access.complete_native_password_setup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare account garments_access.app_user;
begin
 select * into account from garments_access.app_user where user_id = new.id for update;
 if not found then return new; end if;
 if not account.is_active or not exists(
  select 1 from garments_erp.employee e where e.id = account.employee_id and e.is_active
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
$$;
revoke all on function garments_access.complete_native_password_setup() from public, anon, authenticated;
create trigger complete_native_password_setup
after update of encrypted_password on auth.users for each row
when (old.encrypted_password is distinct from new.encrypted_password)
execute function garments_access.complete_native_password_setup();

-- Disable the old Admin-inbox code path, including already-issued tickets.
drop function public.erp_consume_recovery(text,text);
drop function public.erp_issue_recovery(uuid,text,uuid);
drop function garments_access.consume_recovery(text,text);
drop function garments_access.issue_recovery(uuid,text,uuid);
update garments_access.account_recovery set used_at = now() where used_at is null;

create or replace function garments_access.session_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'aal'='aal2',false)
 and coalesce(auth.jwt()->'amr' @> '[{"method":"password"}]'::jsonb,false)
 and exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
 and exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.factor_type='totp' and f.status='verified')
 and exists(select 1 from garments_access.app_user u join garments_erp.employee e on e.id=u.employee_id and e.is_active where u.user_id=auth.uid() and u.is_active and not u.must_change_password);
$$;
create or replace function garments_access.account_security() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',coalesce(u.is_active and e.is_active,false),'mustChangePassword',coalesce(u.must_change_password,false),'ready',garments_access.session_ready(),
  'requiresPasswordSignIn',not coalesce(auth.jwt()->'amr' @> '[{"method":"password"}]'::jsonb,false))
 from (select auth.uid() as id) a left join garments_access.app_user u on u.user_id=a.id left join garments_erp.employee e on e.id=u.employee_id where a.id is not null;
$$;

create function garments_access.has_eligible_administrator() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(
  select 1 from garments_access.app_user u
  join garments_erp.employee e on e.id=u.employee_id and e.is_active
  join garments_access.app_user_role ur on ur.user_id=u.user_id
  join garments_access.app_role r on r.id=ur.role_id
  where u.is_active and not u.must_change_password and r.is_active and r.is_system_admin
   and exists(select 1 from auth.mfa_factors f where f.user_id=u.user_id
      and f.factor_type='totp' and f.status='verified')
 );
$$;
revoke all on function garments_access.has_eligible_administrator() from public, anon, authenticated;

-- A pending invitation cannot serve as the remaining Administrator.
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
 if p_enabled and not exists(select 1 from garments_erp.employee e where e.id=p_employee_id and e.is_active)
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
$function$
;
create or replace function garments_erp.set_employee_active(p_id bigint,p_active boolean,p_expected text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(71426,1);
 if not garments_access.has_screen_permission('employees','edit') then raise exception 'Employee write access required' using errcode='42501';end if;
 if p_active is null then raise exception 'Choose active or inactive';end if;
 perform 1 from garments_erp.employee where id=p_id for update;
 if not found or md5(garments_erp.employee_document(p_id)::text) is distinct from p_expected
   then raise exception 'Employee changed. Reload before saving.' using errcode='40001';end if;
 update garments_erp.employee set is_active=p_active where id=p_id;
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
end $$;

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
 'accounts',(select coalesce(jsonb_agg(jsonb_build_object('user_id',u.user_id,'employee_id',u.employee_id,'is_active',u.is_active,'version',u.version,'employee_code',e.employee_code,'name',c.company_name,'role_ids',(select coalesce(jsonb_agg(ur.role_id),'[]'::jsonb) from garments_access.app_user_role ur where ur.user_id=u.user_id))),'[]'::jsonb) from garments_access.app_user u join garments_erp.employee e on e.id=u.employee_id left join garments_erp.contacts c on c.id=e.contacts_id),
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'employee_code',e.employee_code,'name',c.company_name,'is_active',e.is_active)),'[]'::jsonb) from garments_erp.employee e left join garments_erp.contacts c on c.id=e.contacts_id),
 'auth_accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'phone',u.phone,'email',u.email)),'[]'::jsonb) from auth.users u),
 'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) from (select * from garments_access.app_activity_log order by created_at desc,id desc limit 200) a)
 );
end;
$function$
;
-- Preserve revocation across HR reactivation for previously inactive employees.
with revoked as (
 update garments_access.app_user u set is_active=false, version=u.version+1
 from garments_erp.employee e where u.employee_id=e.id and not e.is_active and u.is_active
 returning u.user_id
)
delete from auth.sessions s using revoked where s.user_id=revoked.user_id;

commit;
