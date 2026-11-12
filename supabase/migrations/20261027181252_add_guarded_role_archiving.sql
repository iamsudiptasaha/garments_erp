begin;
create function garments_access.archive_role(p_role_id bigint,p_expected_version bigint)
returns void language plpgsql security definer set search_path='' as $$
declare target garments_access.app_role;
begin
 perform pg_advisory_xact_lock(71426,1);
 perform garments_access.require_administrator();
 select * into target from garments_access.app_role where id=p_role_id for update;
 if not found then raise exception 'Role no longer exists';end if;
 if target.is_system_admin then raise exception 'The Administrator role cannot be archived';end if;
 if not target.is_active then raise exception 'Role is already archived';end if;
 if target.version is distinct from p_expected_version then raise exception 'Role changed. Reload before archiving' using errcode='40001';end if;
 if exists(select 1 from garments_access.app_user_role where role_id=p_role_id) then raise exception 'Reassign all employees before archiving, including disabled accounts';end if;
 update garments_access.app_role set is_active=false,version=version+1 where id=p_role_id;
 insert into garments_access.app_activity_log(actor_user_id,app_resource_id,action,target_type,target_id,details)
 select auth.uid(),r.id,'Archived role','app_role',p_role_id::text,jsonb_build_object('name',target.name) from garments_access.app_resource r where key='adminRoles';
end;
$$;
create function public.erp_archive_role(p_role_id bigint,p_expected_version bigint)
returns void language sql security invoker set search_path='' as $$select garments_access.archive_role(p_role_id,p_expected_version)$$;
revoke all on function garments_access.archive_role(bigint,bigint),public.erp_archive_role(bigint,bigint) from public,anon,authenticated;
grant execute on function garments_access.archive_role(bigint,bigint),public.erp_archive_role(bigint,bigint) to authenticated;
commit;
