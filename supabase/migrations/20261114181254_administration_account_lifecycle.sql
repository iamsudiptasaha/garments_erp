begin;

create function garments_access.change_account_lifecycle(
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
  delete from auth.flow_state where user_id=p_user_id or linking_target_id=p_user_id;
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

create function public.erp_change_account_lifecycle(
 p_action text, p_user_id uuid, p_employee_id bigint, p_expected_version bigint
) returns void
language sql security invoker set search_path = '' as $$
 select garments_access.change_account_lifecycle(p_action,p_user_id,p_employee_id,p_expected_version)
$$;
revoke all on function public.erp_change_account_lifecycle(text,uuid,bigint,bigint) from public, anon, authenticated;
grant execute on function public.erp_change_account_lifecycle(text,uuid,bigint,bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
