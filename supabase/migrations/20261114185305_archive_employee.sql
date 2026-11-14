begin;

alter table garments_erp.employee add column archived_at timestamptz,
 add constraint archived_employee_inactive check (archived_at is null or is_active is false);

-- Shared by account removal and removal of employees with unfinished invitations.
create function garments_access.retire_auth_identity(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update auth.users set
   updated_at=now(), deleted_at=now(), banned_until='9999-01-01 00:00:00+00',
   email=null, phone=null, encrypted_password=null, email_confirmed_at=null, phone_confirmed_at=null,
   confirmation_token='', recovery_token='', email_change_token_new='', email_change_token_current='',
   email_change='', phone_change='', phone_change_token='', reauthentication_token='',
   raw_app_meta_data='{}', raw_user_meta_data='{}'
  where id=p_user_id;
  delete from auth.sessions where user_id=p_user_id;
  delete from auth.refresh_tokens where user_id=p_user_id::text;
  delete from auth.mfa_factors where user_id=p_user_id;
  delete from auth.identities where user_id=p_user_id;
  delete from auth.one_time_tokens where user_id=p_user_id;
  delete from garments_access.pending_employee_email where user_id=p_user_id;
  delete from auth.flow_state where user_id=p_user_id or linking_target_id=p_user_id;
end;
$$;
revoke all on function garments_access.retire_auth_identity(uuid) from public, anon, authenticated;

create or replace function garments_access.change_account_lifecycle(
 p_action text, p_user_id uuid, p_employee_id bigint, p_expected_version bigint
) returns void
language plpgsql security definer set search_path = '' as $$
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
   not exists(select 1 from garments_erp.employee where id=p_employee_id and is_active)
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
$$;
revoke all on function garments_access.change_account_lifecycle(text,uuid,bigint,bigint) from public, anon, authenticated;
grant execute on function garments_access.change_account_lifecycle(text,uuid,bigint,bigint) to authenticated;

-- Archived employee IDs are retained for references and cannot be assigned new accounts.
create function garments_access.guard_archived_employee_link()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from garments_erp.employee where id=new.employee_id and archived_at is not null) then
  raise exception 'Archived employees cannot receive login access' using errcode='42501';
 end if;
 return new;
end;
$$;
revoke all on function garments_access.guard_archived_employee_link() from public, anon, authenticated;
create trigger guard_archived_employee_link before insert or update of employee_id
on garments_access.app_user for each row execute function garments_access.guard_archived_employee_link();

create function garments_erp.archive_employee(p_id bigint, p_expected text)
returns void language plpgsql security definer set search_path='' as $$
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

 select archived_at into archived from garments_erp.employee where id=p_id for update;
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

 update garments_erp.employee set is_active=false, archived_at=now() where id=p_id;
 if not garments_access.has_eligible_administrator() then
  raise exception 'Keep at least one active Administrator with completed setup';
 end if;
 insert into garments_access.app_activity_log(actor_user_id,app_resource_id,action,target_type,target_id)
 select auth.uid(), id, 'Removed employee', 'employee', p_id::text
 from garments_access.app_resource where key='employees';
end;
$$;
revoke all on function garments_erp.archive_employee(bigint,text) from public, anon, authenticated;
grant execute on function garments_erp.archive_employee(bigint,text) to authenticated;

create function public.erp_archive_employee(p_id bigint, p_expected text)
returns void language sql security invoker set search_path='' as $$
 select garments_erp.archive_employee(p_id,p_expected)
$$;
revoke all on function public.erp_archive_employee(bigint,text) from public, anon, authenticated;
grant execute on function public.erp_archive_employee(bigint,text) to authenticated;

-- Leave archived profiles and attachment references readable, but prevent writes
-- through employee editing, status changes, or the attachment mutation endpoint.
create function garments_erp.guard_archived_employee()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.archived_at is not null then
  raise exception 'Archived employees are read-only';
 end if;
 return new;
end;
$$;
revoke all on function garments_erp.guard_archived_employee() from public, anon, authenticated;
create trigger guard_archived_employee before update on garments_erp.employee
for each row execute function garments_erp.guard_archived_employee();

create or replace function garments_erp.stamp_employee_operator() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor bigint;
begin
 if auth.uid() is null then return new;end if;
 -- Removal has its own authorization and audit entry. Keep the original verifier.
 if tg_op='UPDATE' and old.archived_at is null and new.archived_at is not null then
  return new;
 end if;
 if tg_op='UPDATE' and old.id=garments_access.profile_employee_id()
   and new.employee_photo is distinct from old.employee_photo
   and (to_jsonb(new)-array['employee_photo','updated_at']) =
       (to_jsonb(old)-array['employee_photo','updated_at']) then
   return new;
 end if;
 if not garments_access.has_screen_permission('employees',case when tg_op='INSERT' then 'create' else 'edit' end)
   then raise exception 'Employee write access required' using errcode='42501';end if;
 select employee_id into strict actor from garments_access.app_user where user_id=auth.uid();
 new.verified_by_employee_id:=actor;new.is_verified:=true;
 if tg_op='INSERT' then
  new.is_active:=true;new.activated_by_employee_id:=actor;
 elsif new.is_active is distinct from old.is_active then new.activated_by_employee_id:=actor;
 else new.activated_by_employee_id:=old.activated_by_employee_id;
 end if;
 return new;
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
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'employee_code',e.employee_code,'name',c.company_name,'is_active',e.is_active)),'[]'::jsonb) from garments_erp.employee e left join garments_erp.contacts c on c.id=e.contacts_id where e.archived_at is null),
 'auth_accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'invitation_pending',u.invited_at is not null and u.email_confirmed_at is null,'setup_pending',coalesce(a.must_change_password,false),'mfa_enrolled',exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.factor_type='totp' and f.status='verified'))),'[]'::jsonb) from auth.users u left join garments_access.app_user a on a.user_id=u.id where not exists(select 1 from garments_access.cancelled_employee_invitation x where x.user_id=u.id)),
 'pending_invitations',(select coalesce(jsonb_agg(jsonb_build_object('employee_id',i.employee_id,'email',i.email,'role_ids',i.role_ids,'revision',i.revision)),'[]'::jsonb) from garments_access.employee_invitation i where not exists(select 1 from garments_access.app_user u where u.employee_id=i.employee_id)),
 'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) from (select * from garments_access.app_activity_log order by created_at desc,id desc limit 200) a)
 );
end;
$function$
;

notify pgrst, 'reload schema';
commit;
