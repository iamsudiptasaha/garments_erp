begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$
declare
  fixture jsonb;
begin
  select value into strict fixture from jsonb_array_elements(public.erp_contact_purpose_workspace())
  where value->>'id' = '900001';
  if (fixture->>'uses')::int < 3 then raise exception 'Expected linked Employee and Fabric roles'; end if;
  begin
    update garments_erp.contact_purpose set type = type where false;
    raise exception 'Direct category table writes were allowed';
  exception when insufficient_privilege then null; end;
end;
$$;

do $$
declare
  created jsonb;
  updated jsonb;
  fixture jsonb;
begin
  created := public.erp_save_contact_purpose(null, '  CI live purpose  ', null);
  if created->>'type' is distinct from 'CI live purpose' or jsonb_typeof(created->'id') <> 'string'
    then raise exception 'Expected trimmed name and a stable string ID'; end if;
  begin
    perform public.erp_save_contact_purpose(null, 'ci LIVE purpose', null);
    raise exception 'Duplicate category was accepted';
  exception when unique_violation then null; end;
  begin
    perform public.erp_save_contact_purpose(null, '   ', null);
    raise exception 'Blank category was accepted';
  exception when invalid_parameter_value then null; end;

  select value into created from jsonb_array_elements(public.erp_contact_purpose_workspace())
  where value->>'type' = 'Employee' order by value->>'id' limit 1;
  if created is null then created := public.erp_save_contact_purpose(null, 'Employee', null); end if;
  begin
    perform public.erp_save_contact_purpose((created->>'id')::bigint, 'employee', (created->>'updated_at')::timestamptz);
    raise exception 'The exact Employee registration default was renamed';
  exception when invalid_parameter_value then null; end;

  select value into strict fixture from jsonb_array_elements(public.erp_contact_purpose_workspace())
  where value->>'id' = '900001';
  updated := public.erp_save_contact_purpose(900001, 'CI renamed purpose', (fixture->>'updated_at')::timestamptz);
  if updated->>'id' is distinct from '900001' then raise exception 'Rename changed the purpose ID'; end if;
  if not exists (select from jsonb_array_elements(public.erp_contact_purpose_workspace())
    where value->>'id' = '900001' and value->>'type' = 'CI renamed purpose' and value->'uses' = fixture->'uses')
    then raise exception 'Rename altered the linked role count'; end if;
  begin
    perform public.erp_save_contact_purpose(900001, 'Would overwrite', (fixture->>'updated_at')::timestamptz);
    raise exception 'Stale rename was accepted';
  exception when serialization_failure then null; end;
end;
$$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000002"}',true);
do $$
begin
  begin
    perform public.erp_contact_purpose_workspace();
    raise exception 'Viewer without Contact Purpose permission could read it';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
insert into garments_access.app_role_resource_permission(app_role_id,app_resource_id,can_view)
select role.id,resource.id,true from garments_access.app_role role,garments_access.app_resource resource
where role.key='ci_viewer' and resource.key='contactCategories';

set local role authenticated;
do $$
begin
  if not exists (select from jsonb_array_elements(public.erp_contact_purpose_workspace())
    where value->>'id' = '900001' and value->>'uses' = '0')
    then raise exception 'View-only role should see the category without restricted role counts'; end if;
  begin
    perform public.erp_save_contact_purpose(null, 'Viewer create', null);
    raise exception 'View-only role could create a category';
  exception when insufficient_privilege then null; end;
  begin
    perform public.erp_save_contact_purpose(900001, 'Viewer edit', null);
    raise exception 'View-only role could edit a category';
  exception when insufficient_privilege then null; end;
end;
$$;

set local role anon;
do $$
begin
  begin
    perform public.erp_contact_purpose_workspace();
    raise exception 'Anonymous category listing was allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
rollback;
