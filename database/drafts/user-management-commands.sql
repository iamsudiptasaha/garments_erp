-- APPLIED as Supabase migration 20261027175105. Do not rerun.
-- Protected user-management commands. First-administrator bootstrap is separate.
begin;
alter table garments_access.app_role add column description text not null default '';

create function garments_access.resource_available(p_id bigint)
returns boolean language sql stable set search_path='' as $$
 with recursive ancestry as (
  select r.id,r.parent_resource_id,r.is_active,array[r.id] as path from garments_access.app_resource r where r.id=p_id
  union all
  select r.id,r.parent_resource_id,r.is_active,a.path||r.id from garments_access.app_resource r join ancestry a on r.id=a.parent_resource_id where not r.id=any(a.path)
 ) select coalesce(bool_and(is_active) and not exists(select 1 from ancestry a where a.parent_resource_id=any(a.path)),false) from ancestry;
$$;

create function garments_access.has_screen_permission(p_key text,p_action text)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and exists (
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
$$;

create function garments_access.require_administrator()
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if not garments_access.has_screen_permission('adminRoles','view') then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
end;
$$;

create function garments_access.access_snapshot()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); result jsonb;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if not exists(select 1 from garments_access.app_user where user_id=actor and is_active) then
  return jsonb_build_object('enabled',false,'actor',actor,'reason','Your account is not yet linked and enabled by an administrator.');
 end if;
 select jsonb_build_object('enabled',true,'actor',actor,'employeeId',u.employee_id,
 'permissions',(select coalesce(jsonb_object_agg(r.key,p.actions),'{}'::jsonb) from garments_access.app_resource r cross join lateral (
  select coalesce(jsonb_object_agg(a.action,garments_access.has_screen_permission(r.key,a.action)),'{}'::jsonb) actions
  from unnest(array['view','create','edit','delete','format','export','print']) a(action)
 ) p where r.resource_type='screen'),
 'administrator',garments_access.has_screen_permission('adminRoles','view')) into result
 from garments_access.app_user u where u.user_id=actor;
 return result;
end;
$$;

create function garments_access.admin_snapshot()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform garments_access.require_administrator();
 return jsonb_build_object(
 'roles',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from garments_access.app_role r),
 'resources',(select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order),'[]'::jsonb) from garments_access.app_resource r),
 'permissions',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from garments_access.app_role_resource_permission p),
 'accounts',(select coalesce(jsonb_agg(jsonb_build_object('user_id',u.user_id,'employee_id',u.employee_id,'is_active',u.is_active,'version',u.version,'employee_code',e.employee_code,'name',c.company_name,'role_ids',(select coalesce(jsonb_agg(ur.role_id),'[]'::jsonb) from garments_access.app_user_role ur where ur.user_id=u.user_id))),'[]'::jsonb) from garments_access.app_user u join garments_erp.employee e on e.id=u.employee_id left join garments_erp.contacts c on c.id=e.contacts_id),
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'employee_code',e.employee_code,'name',c.company_name)),'[]'::jsonb) from garments_erp.employee e left join garments_erp.contacts c on c.id=e.contacts_id),
 'auth_accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'phone',u.phone,'email',u.email)),'[]'::jsonb) from auth.users u),
 'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) from (select * from garments_access.app_activity_log order by created_at desc,id desc limit 200) a)
 );
end;
$$;

create function garments_access.save_role(p_input jsonb,p_expected_version bigint default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare role_id bigint; old_role garments_access.app_role; entry record; resource garments_access.app_resource;
begin
 perform pg_advisory_xact_lock(71426,1);
 perform garments_access.require_administrator();
 if nullif(trim(p_input->>'name'),'') is null then raise exception 'Role name is required'; end if;
 if p_input ? 'id' and p_input->>'id' is not null then
  role_id:=(p_input->>'id')::bigint;
  select * into old_role from garments_access.app_role where id=role_id for update;
  if not found then raise exception 'Role no longer exists'; end if;
  if old_role.is_system_admin then raise exception 'Administrator role is protected'; end if;
  if p_expected_version is distinct from old_role.version then raise exception 'Role changed. Reload before saving' using errcode='40001'; end if;
  update garments_access.app_role set name=trim(p_input->>'name'),description=coalesce(p_input->>'description',''),version=version+1 where id=role_id;
 else
  insert into garments_access.app_role(key,name,description) values ('custom:'||gen_random_uuid()::text,trim(p_input->>'name'),coalesce(p_input->>'description','')) returning id into role_id;
 end if;
 -- Validate every submitted resource/action before replacing grants.
 for entry in select key,value from jsonb_each(coalesce(p_input->'permissions','{}'::jsonb)) loop
  select * into resource from garments_access.app_resource where key=entry.key and resource_type='screen';
  if not found then raise exception 'Unknown screen: %',entry.key; end if;
  if jsonb_typeof(entry.value)<>'object' then raise exception 'Invalid permissions'; end if;
  if exists(select 1 from jsonb_each(entry.value) a where a.key not in ('view','create','edit','delete','format','export','print') or jsonb_typeof(a.value)<>'boolean') then raise exception 'Invalid permission action'; end if;
  if resource.admin_only and exists(select 1 from jsonb_each(entry.value) a where a.value='true'::jsonb) then raise exception 'Administration is reserved for Administrator accounts'; end if;
  if coalesce((entry.value->>'delete')::boolean,false) then raise exception 'Deletion is not available in this pilot'; end if;
 end loop;
 delete from garments_access.app_role_resource_permission where app_role_id=role_id;
 insert into garments_access.app_role_resource_permission(app_role_id,app_resource_id,can_view,can_create,can_edit,can_delete,can_format,can_export,can_print)
 select role_id,r.id,coalesce((p.value->>'view')::boolean,false),coalesce((p.value->>'create')::boolean,false),coalesce((p.value->>'edit')::boolean,false),false,coalesce((p.value->>'format')::boolean,false),coalesce((p.value->>'export')::boolean,false),coalesce((p.value->>'print')::boolean,false)
 from jsonb_each(coalesce(p_input->'permissions','{}'::jsonb)) p join garments_access.app_resource r on r.key=p.key;
 insert into garments_access.app_activity_log(actor_user_id,app_resource_id,action,target_type,target_id,details)
 select auth.uid(),r.id,case when old_role.id is null then 'Created role' else 'Updated role' end,'app_role',role_id::text,jsonb_build_object('name',trim(p_input->>'name')) from garments_access.app_resource r where key='adminRoles';
 return role_id;
end;
$$;

create function garments_access.save_account_access(p_user_id uuid,p_employee_id bigint,p_role_ids bigint[],p_enabled boolean,p_expected_version bigint default null)
returns void language plpgsql security definer set search_path='' as $$
declare account garments_access.app_user;
begin
 perform pg_advisory_xact_lock(71426,1);
 perform garments_access.require_administrator();
 if p_enabled is null or coalesce(cardinality(p_role_ids),0)=0 then raise exception 'Choose at least one role and an account status'; end if;
 if exists(select 1 from unnest(p_role_ids) id where not exists(select 1 from garments_access.app_role r where r.id=id and r.is_active)) then raise exception 'Choose active roles'; end if;
 select * into account from garments_access.app_user where user_id=p_user_id for update;
 if found then
  if p_expected_version is distinct from account.version then raise exception 'Account changed. Reload before saving' using errcode='40001'; end if;
  if account.employee_id<>p_employee_id then raise exception 'An account cannot be moved to a different employee'; end if;
  update garments_access.app_user set is_active=p_enabled,version=version+1 where user_id=p_user_id;
 else
  if p_expected_version is not null then raise exception 'Account no longer exists'; end if;
  insert into garments_access.app_user(user_id,employee_id,is_active,created_by) values(p_user_id,p_employee_id,p_enabled,auth.uid());
 end if;
 delete from garments_access.app_user_role where user_id=p_user_id;
 insert into garments_access.app_user_role(user_id,role_id,created_by) select p_user_id,id,auth.uid() from (select distinct unnest(p_role_ids) id) r;
 if not exists(select 1 from garments_access.app_user u join garments_access.app_user_role ur on ur.user_id=u.user_id join garments_access.app_role r on r.id=ur.role_id where u.is_active and r.is_active and r.is_system_admin) then raise exception 'Keep at least one active Administrator'; end if;
 insert into garments_access.app_activity_log(actor_user_id,app_resource_id,action,target_type,target_id,details)
 select auth.uid(),r.id,'Updated account access','app_user',p_user_id::text,jsonb_build_object('employee_id',p_employee_id,'enabled',p_enabled,'role_ids',p_role_ids) from garments_access.app_resource r where key='adminAccess';
end;
$$;

-- Public wrappers are invokers. Only the named, guarded private commands are
-- callable; table access remains revoked and no role can self-assign.
create function public.erp_access_snapshot() returns jsonb language sql security invoker set search_path='' as $$select garments_access.access_snapshot()$$;
create function public.erp_admin_snapshot() returns jsonb language sql security invoker set search_path='' as $$select garments_access.admin_snapshot()$$;
create function public.erp_save_role(p_input jsonb,p_expected_version bigint default null) returns bigint language sql security invoker set search_path='' as $$select garments_access.save_role(p_input,p_expected_version)$$;
create function public.erp_save_account_access(p_user_id uuid,p_employee_id bigint,p_role_ids bigint[],p_enabled boolean,p_expected_version bigint default null) returns void language sql security invoker set search_path='' as $$select garments_access.save_account_access(p_user_id,p_employee_id,p_role_ids,p_enabled,p_expected_version)$$;

revoke all on function garments_access.resource_available(bigint),garments_access.has_screen_permission(text,text),garments_access.require_administrator(),garments_access.access_snapshot(),garments_access.admin_snapshot(),garments_access.save_role(jsonb,bigint),garments_access.save_account_access(uuid,bigint,bigint[],boolean,bigint) from public,anon,authenticated;
revoke all on function public.erp_access_snapshot(),public.erp_admin_snapshot(),public.erp_save_role(jsonb,bigint),public.erp_save_account_access(uuid,bigint,bigint[],boolean,bigint) from public,anon,authenticated;
grant usage on schema garments_access to authenticated;
grant execute on function garments_access.access_snapshot(),garments_access.admin_snapshot(),garments_access.save_role(jsonb,bigint),garments_access.save_account_access(uuid,bigint,bigint[],boolean,bigint) to authenticated;
grant execute on function public.erp_access_snapshot(),public.erp_admin_snapshot(),public.erp_save_role(jsonb,bigint),public.erp_save_account_access(uuid,bigint,bigint[],boolean,bigint) to authenticated;
commit;
