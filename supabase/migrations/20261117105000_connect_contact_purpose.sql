begin;

create function garments_erp.contact_purpose_workspace() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  can_fabric boolean := garments_access.has_screen_permission('suppliers', 'view');
  can_inventory boolean := garments_access.has_screen_permission('materialSuppliers', 'view');
  can_employee boolean := garments_access.has_screen_permission('employees', 'view');
begin
  if not garments_access.has_screen_permission('contactCategories', 'view') then
    raise exception 'Contact Purpose view access required' using errcode='42501';
  end if;
  return (
    with role_links as (
      select contact_purpose_id as purpose from garments_erp.raw_material_supplier_list where can_inventory
      union all
      select contact_purpose_id from garments_erp.yarn_supplier where can_fabric
      union all
      select contact_purpose_id from garments_erp.knitter where can_fabric
      union all
      select contact_purpose_id from garments_erp.dyer where can_fabric
      union all
      select contact_purpose_id from garments_erp.employee where can_employee
      union all
      select contact_purpose_emergency_id from garments_erp.employee
      where can_employee and contact_purpose_emergency_id is distinct from contact_purpose_id
    ),
    counts as (select purpose, count(*) as uses from role_links group by purpose)
    select coalesce(jsonb_agg(
      jsonb_build_object('id', p.id::text, 'type', p.type, 'updated_at', p.updated_at,
                         'uses', coalesce(counts.uses, 0))
      order by p.id
    ), '[]'::jsonb)
    from garments_erp.contact_purpose p left join counts on counts.purpose = p.id
  );
end;
$$;

create function garments_erp.save_contact_purpose(p_id bigint, p_type text, p_expected timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  category_name text := btrim(p_type);
  saved garments_erp.contact_purpose;
begin
  if not garments_access.has_screen_permission('contactCategories', 'view')
    or not garments_access.has_screen_permission('contactCategories', case when p_id is null then 'create' else 'edit' end) then
    raise exception 'Contact Purpose write access required' using errcode='42501';
  end if;
  if nullif(category_name, '') is null then
    raise exception 'Enter a category name.' using errcode='22023';
  end if;

  -- Serialize the duplicate check with other changes to this small reference table.
  lock table garments_erp.contact_purpose in share row exclusive mode;
  if p_id is not null and not exists (
    select 1 from garments_erp.contact_purpose where id = p_id and updated_at is not distinct from p_expected
  ) then
    raise exception 'Contact Purpose changed. Reload before saving.' using errcode='40001';
  end if;
  -- Employee registration resolves its required default by this exact name.
  if category_name <> 'Employee' and exists (
    select 1 from garments_erp.contact_purpose where id = p_id and type = 'Employee'
  ) then
    raise exception 'Employee is used as the registration default and cannot be renamed.' using errcode='22023';
  end if;
  if exists (
    select 1 from garments_erp.contact_purpose
    where id is distinct from p_id and lower(btrim(type)) = lower(category_name)
  ) then
    raise exception 'This name already exists. Edit the existing record.' using errcode='23505';
  end if;
  if p_id is null then
    insert into garments_erp.contact_purpose(type) values (category_name) returning * into saved;
  else
    update garments_erp.contact_purpose set type = category_name where id = p_id returning * into saved;
  end if;
  return jsonb_build_object('id', saved.id::text, 'type', saved.type, 'updated_at', saved.updated_at);
end;
$$;

create function public.erp_contact_purpose_workspace() returns jsonb
language sql stable security invoker set search_path='' as $$
  select garments_erp.contact_purpose_workspace();
$$;
create function public.erp_save_contact_purpose(p_id bigint, p_type text, p_expected timestamptz)
returns jsonb language sql security invoker set search_path='' as $$
  select garments_erp.save_contact_purpose(p_id, p_type, p_expected);
$$;

revoke all on function garments_erp.contact_purpose_workspace(), garments_erp.save_contact_purpose(bigint, text, timestamptz),
  public.erp_contact_purpose_workspace(), public.erp_save_contact_purpose(bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function garments_erp.contact_purpose_workspace(), garments_erp.save_contact_purpose(bigint, text, timestamptz),
  public.erp_contact_purpose_workspace(), public.erp_save_contact_purpose(bigint, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
