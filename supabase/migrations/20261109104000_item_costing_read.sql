begin;

create function garments_erp.costing_ready_items()
returns table (id bigint, label text)
language sql stable set search_path = ''
as $$
  select i.id, i.style_code
  from garments_erp.item i
  where exists (select 1 from garments_erp.item_part ip where ip.item_id = i.id)
    and not exists (
      select 1 from garments_erp.item_part ip where ip.item_id = i.id
      and not exists (
        select 1 from garments_erp.production p
        join garments_erp.job j on j.production_id = p.id and j.latest
        join garments_erp.stage st on st.id = j.stage_id
        join garments_erp.stage_type typ on typ.id = st.stage_type_id
        where p.item_part_id = ip.id and lower(typ.name) = 'complete'
      )
    );
$$;

revoke all on function garments_erp.costing_ready_items() from public, anon, authenticated, service_role;

create function public.erp_item_costing_read(p_item_id bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not garments_access.has_screen_permission('finishedProducts', 'view') then
    raise exception 'Finished Products view access required' using errcode = '42501';
  end if;

  if p_item_id is null then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id::text, 'label', i.label) order by i.label, i.id)
      from garments_erp.costing_ready_items() i
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id::text, 'item_label', i.style_code, 'version', c.version,
        'status', status.name, 'completed_units', c.completed_units, 'updated_at', c.updated_at,
        'lines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', line.id::text, 'section', section.section, 'peripheral_type', peripheral.type,
            'description', line.description, 'reference_quantity', line.reference_quantity,
            'reference_amount', case when status.name = 'draft' and issue.id is not null
              then issue.quantity * receipt.billed_price else line.reference_amount end,
            'approved_quantity', line.approved_quantity,
            'approved_rate', line.approved_rate, 'variant_item_id', variant.id::text,
            'part_id', part.id::text, 'part_label', pl.part, 'variant_label', v.variant_name
          ) order by line.id)
          from garments_erp.item_costing_item line
          left join garments_erp.item_costing_section section on section.id = line.item_costing_section_id
          left join garments_erp.item_costing_peripherals_type peripheral on peripheral.id = line.item_costing_peripherals_type_id
          left join garments_erp.raw_material_check_out issue on issue.id = line.raw_material_check_out_id
          left join garments_erp.raw_material_check_in receipt on receipt.id = issue.raw_material_check_in_id
          left join garments_erp.variant_item variant on variant.id = issue.variant_item_id
          left join garments_erp.variant v on v.id = variant.variant_id
          left join garments_erp.item_part part on part.id = variant.item_part_id
          left join garments_erp.part_list pl on pl.id = part.part_list_id
          where line.item_costing_id = c.id
        ), '[]'::jsonb)
      ) order by c.version desc
    )
    from garments_erp.item_costing c
    join garments_erp.item i on i.id = c.item_id
    join garments_erp.item_costing_status status on status.id = c.item_costing_status_id
    where c.item_id = p_item_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.erp_item_costing_read(bigint) from public, anon, authenticated, service_role;
grant execute on function public.erp_item_costing_read(bigint) to authenticated;

commit;
