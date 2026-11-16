begin;

create or replace function garments_erp.production_setup_contract()
returns jsonb language sql immutable set search_path = '' as $$
  select '{"productionItems": {"item": ["style_code", "brand_id", "story", "season", "product_type_list_id", "product_description", "base_price", "batch_number"], "item_part": ["item_id", "part_list_id", "parent_item_part_id"], "item_size_list": ["item_id", "size_list_id"], "item_cut_ratio": ["item_size_list_id", "pieces"], "variant_item": ["item_part_id", "variant_id", "lab_dip_id"], "production_checklist": ["item_id", "fpt_gpt_status_id", "photoshoot_sample_status_id", "shipment_sample_status_id", "techpack_aqcuired_status_id", "ordersheet_acquired_status_id"]}, "productionWorkers": {"job_worker": ["contacts_id", "contact_purpose_id"]}, "productionDesigns": {"variant": ["variant_name", "share_weight"]}, "productionStages": {"stage": ["name", "abbr", "sort_order", "stage_type_id", "track_pieces", "pp_stage"]}, "productionStageTypes": {"stage_type": ["name"]}, "productionPartTypes": {"part_list": ["part"]}, "productionSizes": {"size_list": ["size", "sort_order"]}, "productionProductTypes": {"product_type_list": ["product_type", "gender_id"]}, "productionStatuses": {"item_status_list": ["status"]}, "productionFlags": {"flags_list": ["name"]}, "productionGenders": {"gender": ["name"]}}'::jsonb
$$;

create or replace function garments_erp.fabric_contract()
returns jsonb language sql immutable set search_path = '' as $$
  select '{"yarnTypes": {"yarn_type": ["name", "yarn_count"]}, "fabricTypes": {"fabric_type": ["name", "series"]}, "brands": {"brand_list": ["brand", "contacts_id", "contact_purpose_id"]}, "colours": {"color_map": ["name", "pantone_code"]}, "colourMappings": {"color_map_by_brand": ["color_map_id", "brand_list_id"]}, "labDips": {"lab_dip": ["date", "edition", "color_map_by_brand_id", "dyer_id"], "lab_dip_version": ["lab_dip_id", "version", "date", "shade_card_no", "shade_card_option", "comments", "lab_dip_status_id", "attached_swatch"]}, "suppliers": {"contacts": ["company_name"], "yarn_supplier": ["contacts_id", "contact_purpose_id"], "knitter": ["contacts_id", "contact_purpose_id"], "dyer": ["contacts_id", "contact_purpose_id"]}, "orders": {"yarn_purchase_order": ["yarn_supplier_id"], "yarn_purchase_order_item": ["purchase_order_number_id", "yarn_type_id", "quantity", "rate"]}, "yarn": {"yarn_bill": ["invoice_number", "invoice_date"], "yarn_bill_item": ["yarn_bill_id", "yarn_purchase_order_item_id", "billed_quantity", "billed_rate", "billed_bags"]}, "knitting": {"knitting_bill": ["invoice_number", "invoice_date", "knitter_id"], "knitting_bill_item": ["knitting_bill_id", "yarn_bill_item_id", "fabric_type_id", "greige_gsm", "consumption", "billed_quantity", "billed_rate", "billed_rolls"]}, "programs": {"dyeing_program": ["date", "dyer_id"], "dyeing_program_item": ["dyeing_program_id", "fabric_type_id", "quantity", "lab_dip_version_id", "batch_no", "comments"]}, "dyeBills": {"dyed_fabric_bill": ["invoice_number", "invoice_date"], "dyed_fabric_item": ["dyed_fabric_bill_id", "dyeing_program_item_id", "knitting_bill_item_id", "gross_quantity", "billed_quantity", "final_quantity", "dyeing_rolls", "dyeing_rate"], "batch_no_lab_dip_version_map": ["dyed_fabric_item_id", "batch_no", "lab_dip_version_id"]}, "dyed": {}, "yarnLeft": {}, "greige": {}, "batches": {}}'::jsonb
$$;

create function garments_erp.fabric_planner_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not garments_access.has_screen_permission('productionItems', 'view')
      or not garments_access.has_screen_permission('programs', 'view') then
    raise exception 'Fabric planner requires item and dyeing program access' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'variants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', vi.id::text, 'item_id', i.id::text, 'style_code', i.style_code,
        'variant', v.variant_name, 'colour', colour.name,
        'part_id', part.id::text, 'part', name.part, 'parent_id', part.parent_item_part_id::text,
        'lab_dip_id', vi.lab_dip_id::text
      ) order by i.style_code, part.id, vi.id), '[]')
      from garments_erp.variant_item vi
      join garments_erp.item_part part on part.id = vi.item_part_id
      join garments_erp.part_list name on name.id = part.part_list_id
      join garments_erp.item i on i.id = part.item_id
      join garments_erp.variant v on v.id = vi.variant_id
      left join garments_erp.lab_dip lab on lab.id = vi.lab_dip_id
      left join garments_erp.color_map_by_brand mapping on mapping.id = lab.color_map_by_brand_id
      left join garments_erp.color_map colour on colour.id = mapping.color_map_id
    ),
    'fabric_types', (
      select coalesce(jsonb_agg(jsonb_build_object('id', f.id::text, 'name', f.name)
        order by f.name, f.id), '[]')
      from garments_erp.fabric_type f
    ),
    'requirements', (
      select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
        'id', r.id::text, 'variant_item_id', r.variant_item_id::text,
        'fabric_type_id', r.fabric_type_id::text, 'item_part_id', r.item_part_id::text,
        'item_id', r.item_id::text, 'variant_id', r.variant_id::text,
        'lab_dip_id', r.lab_dip_id::text, 'root_item_part_id', r.root_item_part_id::text,
        'production_id', r.production_id::text
      ) order by r.id), '[]')
      from garments_erp.fabric_plan_estimates r
    ),
    'program_items', (
      select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object(
        'dyeing_program_item_id', p.id::text, 'dyeing_program_id', program.id::text,
        'fabric_type_id', p.fabric_type_id::text, 'lab_dip_id', version.lab_dip_id::text,
        'lab_dip_version', version.version, 'program_number', program.program_number
      ) order by program.id, p.id), '[]')
      from garments_erp.fabric_plan_dyeing_surplus q
      join garments_erp.dyeing_program_item p on p.id = q.dyeing_program_item_id
      join garments_erp.dyeing_program program on program.id = p.dyeing_program_id
      join garments_erp.lab_dip_version version on version.id = p.lab_dip_version_id
    ),
    'links', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'item_part_fabric_id', l.item_part_fabric_id::text,
        'dyeing_program_item_id', l.dyeing_program_item_id::text
      ) order by l.item_part_fabric_id, l.dyeing_program_item_id), '[]')
      from garments_erp.fabric_plan_dyeing_link l
    )
  );
end $$;

create function garments_erp.save_fabric_requirement(
  p_variant bigint, p_fabric_type bigint, p_expected_kg numeric, p_consumption_kg numeric
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing garments_erp.item_part_fabric;
begin
  if auth.uid() is null or not garments_access.has_screen_permission('productionItems', 'edit')
      or not garments_access.has_screen_permission('programs', 'view') then
    raise exception 'Fabric planner edit permission required' using errcode = '42501';
  end if;
  perform 1 from garments_erp.variant_item where id = p_variant for update;
  if not found then
    raise exception 'Select an existing variant part' using errcode = '23503';
  end if;
  select * into existing from garments_erp.item_part_fabric
    where variant_item_id = p_variant and fabric_type_id = p_fabric_type for update;
  if existing.consumption_per_piece_kg is distinct from p_expected_kg then
    raise exception 'Fabric requirement changed. Reload before saving.' using errcode = '40001';
  end if;
  if p_consumption_kg is null then
    delete from garments_erp.item_part_fabric where id = existing.id;
  elsif existing.id is null then
    insert into garments_erp.item_part_fabric(variant_item_id, fabric_type_id, consumption_per_piece_kg)
      values (p_variant, p_fabric_type, p_consumption_kg);
  else
    update garments_erp.item_part_fabric set consumption_per_piece_kg = p_consumption_kg where id = existing.id;
  end if;
  return garments_erp.fabric_planner_snapshot();
end $$;

create function garments_erp.set_fabric_plan_dyeing_link(
  p_requirement bigint, p_program_item bigint, p_linked boolean, p_screen text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_screen is null or p_screen not in ('productionItems', 'programs')
      or not garments_access.has_screen_permission(p_screen, 'edit')
      or not garments_access.has_screen_permission('productionItems', 'view')
      or not garments_access.has_screen_permission('programs', 'view') then
    raise exception 'Fabric planner link permission required' using errcode = '42501';
  end if;
  if p_linked then
    insert into garments_erp.fabric_plan_dyeing_link(item_part_fabric_id, dyeing_program_item_id)
      values (p_requirement, p_program_item) on conflict do nothing;
  else
    delete from garments_erp.fabric_plan_dyeing_link
      where item_part_fabric_id = p_requirement and dyeing_program_item_id = p_program_item;
  end if;
  return garments_erp.fabric_planner_snapshot();
end $$;

create function public.erp_fabric_planner_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select garments_erp.fabric_planner_snapshot()
$$;
create function public.erp_save_fabric_requirement(
  p_variant bigint, p_fabric_type bigint, p_expected_kg numeric, p_consumption_kg numeric
)
returns jsonb language sql security invoker set search_path = '' as $$
  select garments_erp.save_fabric_requirement($1, $2, $3, $4)
$$;
create function public.erp_set_fabric_plan_dyeing_link(
  p_requirement bigint, p_program_item bigint, p_linked boolean, p_screen text
)
returns jsonb language sql security invoker set search_path = '' as $$
  select garments_erp.set_fabric_plan_dyeing_link($1, $2, $3, $4)
$$;

revoke execute on function garments_erp.fabric_planner_snapshot(),
  garments_erp.save_fabric_requirement(bigint, bigint, numeric, numeric),
  garments_erp.set_fabric_plan_dyeing_link(bigint, bigint, boolean, text),
  public.erp_fabric_planner_snapshot(), public.erp_save_fabric_requirement(bigint, bigint, numeric, numeric),
  public.erp_set_fabric_plan_dyeing_link(bigint, bigint, boolean, text) from public, anon;
grant execute on function garments_erp.fabric_planner_snapshot(),
  garments_erp.save_fabric_requirement(bigint, bigint, numeric, numeric),
  garments_erp.set_fabric_plan_dyeing_link(bigint, bigint, boolean, text),
  public.erp_fabric_planner_snapshot(), public.erp_save_fabric_requirement(bigint, bigint, numeric, numeric),
  public.erp_set_fabric_plan_dyeing_link(bigint, bigint, boolean, text) to authenticated;

commit;
