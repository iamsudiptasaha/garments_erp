-- Review and approve before production application. No Auth credentials in business tables.
begin;
grant usage on schema garments_access to service_role;
alter table garments_access.app_user add column must_change_password boolean not null default false;
create table garments_access.account_recovery (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 digest text not null, attempts integer not null default 0 check(attempts between 0 and 5),
 expires_at timestamptz not null default now()+interval '15 minutes', used_at timestamptz,
 created_at timestamptz not null default now(), created_by uuid not null references auth.users(id)
);
create index on garments_access.account_recovery(user_id,created_at desc);
alter table garments_access.account_recovery enable row level security;
revoke all on garments_access.account_recovery from public,anon,authenticated;
grant all on garments_access.account_recovery to service_role;
create function garments_access.session_ready() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'aal'='aal2',false)
 and exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
 and exists(select 1 from garments_access.app_user u where u.user_id=auth.uid() and u.is_active and not u.must_change_password);
$$;
CREATE OR REPLACE FUNCTION garments_access.has_screen_permission(p_key text, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select garments_access.session_ready() and (select auth.uid()) is not null and exists (
  select 1 from garments_access.app_user u
  join garments_access.app_user_role ur on ur.user_id=u.user_id
  join garments_access.app_role role on role.id=ur.role_id and role.is_active
  join garments_access.app_resource resource on resource.key=p_key and garments_access.resource_available(resource.id)
  left join garments_access.app_role_resource_permission permission on permission.app_role_id=role.id and permission.app_resource_id=resource.id
  where u.user_id=(select auth.uid()) and u.is_active
   and p_action in ('view','create','edit','delete','format','export','print')
   and (not resource.admin_only or role.is_system_admin)
   and (role.is_system_admin or (permission.can_view and case p_action
    when 'view' then permission.can_view when 'create' then permission.can_create
    when 'edit' then permission.can_edit when 'delete' then permission.can_delete
    when 'format' then permission.can_format when 'export' then permission.can_export
    when 'print' then permission.can_print else false end))
 );
$function$
;

create function garments_access.account_security() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',coalesce(u.is_active,false),'mustChangePassword',coalesce(u.must_change_password,false),'ready',garments_access.session_ready())
 from (select auth.uid() as id) a left join garments_access.app_user u on u.user_id=a.id where a.id is not null;
$$;
revoke all on function garments_access.account_security() from public,anon;
grant execute on function garments_access.account_security() to authenticated;
create function public.erp_account_security() returns jsonb language sql stable security invoker set search_path='' as $$ select garments_access.account_security(); $$;
revoke all on function public.erp_account_security() from public,anon;
grant execute on function public.erp_account_security() to authenticated;
create function garments_access.consume_recovery(p_phone text,p_digest text) returns uuid language plpgsql security definer set search_path='' as $$
declare r garments_access.account_recovery; target uuid;
begin
 select u.user_id into target from garments_access.app_user u join auth.users a on a.id=u.user_id where u.is_active and a.phone=ltrim(p_phone,'+');
 if target is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,901));
 select * into r from garments_access.account_recovery where user_id=target and used_at is null order by created_at desc limit 1 for update;
 if not found or r.expires_at<=now() or r.attempts>=5 then return null;end if;
 update garments_access.account_recovery set attempts=attempts+1 where id=r.id;
 if r.digest<>p_digest then return null;end if;
 update garments_access.account_recovery set used_at=now() where user_id=target and used_at is null;
 -- Lock out every existing portal session until reset and a fresh login.
 update garments_access.app_user set must_change_password=true,version=version+1 where user_id=target;
 delete from auth.sessions where user_id=target;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id) values(r.created_by,'Consumed password recovery','app_user',target::text);
 return target;
end $$;
revoke all on function garments_access.consume_recovery(text,text) from public,anon,authenticated;
grant execute on function garments_access.consume_recovery(text,text) to service_role;
revoke all on function garments_access.session_ready() from public,anon,authenticated;
grant execute on function garments_access.session_ready() to service_role;
create function garments_access.issue_recovery(p_user_id uuid,p_digest text,p_actor uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,901));
 if not exists(select 1 from garments_access.app_user u join garments_access.app_user_role ur on ur.user_id=u.user_id join garments_access.app_role r on r.id=ur.role_id where u.user_id=p_actor and u.is_active and r.is_active and r.is_system_admin) then raise exception 'Administrator required';end if;
 if not exists(select 1 from garments_access.app_user where user_id=p_user_id and is_active) then raise exception 'Account unavailable';end if;
 if exists(select 1 from garments_access.account_recovery where user_id=p_user_id and created_at>now()-interval '1 minute') then raise exception 'Wait one minute before requesting another code';end if;
 update garments_access.account_recovery set used_at=now() where user_id=p_user_id and used_at is null;
 insert into garments_access.account_recovery(user_id,digest,created_by) values(p_user_id,p_digest,p_actor) returning id into result;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id) values(p_actor,'Issued recovery credential','app_user',p_user_id::text);
 return result;
end $$;
create function garments_access.account_internal(p_action text,p_user_id uuid default null,p_ticket uuid default null) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_action='unlinked' then return not exists(select 1 from garments_access.app_user where user_id=p_user_id);
 elsif p_action='force' then update garments_access.app_user set must_change_password=true,version=version+1 where user_id=p_user_id;
 elsif p_action='cancel' then update garments_access.account_recovery set used_at=now() where id=p_ticket;
 elsif p_action='complete' then
  delete from auth.sessions where user_id=p_user_id;
  update garments_access.app_user set must_change_password=false,version=version+1 where user_id=p_user_id;
  insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id) values(p_user_id,'Updated account password','app_user',p_user_id::text);
 else raise exception 'Unknown operation';end if;
 return true;
end $$;
revoke all on function garments_access.issue_recovery(uuid,text,uuid),garments_access.account_internal(text,uuid,uuid) from public,anon,authenticated;
grant execute on function garments_access.issue_recovery(uuid,text,uuid),garments_access.account_internal(text,uuid,uuid) to service_role;
create function public.erp_consume_recovery(p_phone text,p_digest text) returns uuid language sql security invoker set search_path='' as $$ select garments_access.consume_recovery(p_phone,p_digest); $$;
revoke all on function public.erp_consume_recovery(text,text) from public,anon,authenticated;
grant execute on function public.erp_consume_recovery(text,text) to service_role;
create function public.erp_issue_recovery(p_user_id uuid,p_digest text,p_actor uuid) returns uuid language sql security invoker set search_path='' as $$ select garments_access.issue_recovery(p_user_id,p_digest,p_actor); $$;
revoke all on function public.erp_issue_recovery(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.erp_issue_recovery(uuid,text,uuid) to service_role;
create function public.erp_account_internal(p_action text,p_user_id uuid default null,p_ticket uuid default null) returns boolean language sql security invoker set search_path='' as $$ select garments_access.account_internal(p_action,p_user_id,p_ticket); $$;
revoke all on function public.erp_account_internal(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.erp_account_internal(text,uuid,uuid) to service_role;
commit;
