begin;

-- A durable reservation ties a native invitation to the exact employee and roles.
-- Only a new Auth invitation that presents the reservation can bind its identity.
create table garments_access.employee_invitation (
 employee_id bigint primary key references garments_erp.employee(id),
 email text unique,
 role_ids bigint[] not null,
 revision uuid not null unique default gen_random_uuid(),
 nonce uuid not null unique default gen_random_uuid(),
 user_id uuid unique references auth.users(id) on delete cascade,
 last_attempt_at timestamptz,
 check (email is not null or user_id is not null)
);
alter table garments_access.employee_invitation enable row level security;
revoke all on garments_access.employee_invitation from public, anon, authenticated;

-- Keep cancelled identities out of legacy linking and remember the nonce even
-- when Auth had not yet committed the invitation.
create table garments_access.cancelled_employee_invitation (
 nonce uuid primary key,
 user_id uuid unique
);
alter table garments_access.cancelled_employee_invitation enable row level security;
revoke all on garments_access.cancelled_employee_invitation from public, anon, authenticated;

create function garments_access.bind_employee_invitation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.invited_at is not null and (tg_op='INSERT' or old.invited_at is null) then
  update garments_access.employee_invitation
  set user_id=new.id
  where nonce::text=new.raw_user_meta_data->>'erp_invitation'
   and email=lower(new.email) and user_id is null;
  if not found and exists(select 1 from garments_access.cancelled_employee_invitation
    where nonce::text=new.raw_user_meta_data->>'erp_invitation') then
   raise exception 'This employee invitation was cancelled';
  end if;
 end if;
 return new;
end $$;
revoke all on function garments_access.bind_employee_invitation() from public, anon, authenticated;
create trigger bind_employee_invitation after insert or update of invited_at on auth.users
for each row execute function garments_access.bind_employee_invitation();

-- The legacy link command may still link existing accounts. It must respect
-- reservations created by this flow, including those still waiting on Auth.
create function garments_access.guard_employee_invitation_link() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from garments_access.cancelled_employee_invitation where user_id=new.user_id) then
  raise exception 'This employee invitation was cancelled';
 end if;
 if exists(select 1 from garments_access.employee_invitation i
  where (i.employee_id=new.employee_id and i.user_id is distinct from new.user_id)
     or (i.user_id=new.user_id and i.employee_id<>new.employee_id)) then
  raise exception 'Use the original employee invitation to link this account';
 end if;
 return new;
end $$;
revoke all on function garments_access.guard_employee_invitation_link() from public, anon, authenticated;
create trigger guard_employee_invitation_link before insert or update of user_id, employee_id on garments_access.app_user
for each row execute function garments_access.guard_employee_invitation_link();

-- The Edge Function supplies the authenticated caller's JWT. Each step checks
-- current Administrator eligibility, including after the external Auth call.
create function garments_access.employee_invitation_command(
 p_action text, p_employee_id bigint, p_email text default null, p_role_ids bigint[] default null, p_revision uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 pending garments_access.employee_invitation;
 linked garments_access.app_user;
 destination text;
 email_input text := lower(trim(p_email));
 requested_roles bigint[];
begin
 perform pg_advisory_xact_lock(71426,1);
 perform garments_access.require_administrator();
 if p_action<>'cancel' and not exists(select 1 from garments_erp.employee where id=p_employee_id and is_active) then
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
end $$;
revoke all on function garments_access.employee_invitation_command(text,bigint,text,bigint[],uuid) from public, anon, authenticated;
grant execute on function garments_access.employee_invitation_command(text,bigint,text,bigint[],uuid) to authenticated;
create function public.erp_employee_invitation(
 p_action text, p_employee_id bigint, p_email text default null, p_role_ids bigint[] default null, p_revision uuid default null
) returns jsonb language sql security invoker set search_path='' as $$
 select garments_access.employee_invitation_command(p_action,p_employee_id,p_email,p_role_ids,p_revision)
$$;
revoke all on function public.erp_employee_invitation(text,bigint,text,bigint[],uuid) from public, anon, authenticated;
grant execute on function public.erp_employee_invitation(text,bigint,text,bigint[],uuid) to authenticated;

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
 'auth_accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'invitation_pending',u.invited_at is not null and u.email_confirmed_at is null,'setup_pending',coalesce(a.must_change_password,false),'mfa_enrolled',exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.factor_type='totp' and f.status='verified'))),'[]'::jsonb) from auth.users u left join garments_access.app_user a on a.user_id=u.id where not exists(select 1 from garments_access.cancelled_employee_invitation x where x.user_id=u.id)),
 'pending_invitations',(select coalesce(jsonb_agg(jsonb_build_object('employee_id',i.employee_id,'email',i.email,'role_ids',i.role_ids,'revision',i.revision)),'[]'::jsonb) from garments_access.employee_invitation i where not exists(select 1 from garments_access.app_user u where u.employee_id=i.employee_id)),
 'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) from (select * from garments_access.app_activity_log order by created_at desc,id desc limit 200) a)
 );
end;
$function$
;

commit;
