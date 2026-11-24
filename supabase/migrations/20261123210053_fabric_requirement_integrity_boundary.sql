-- Complete deferred checks inside existing authorized save boundaries.
-- No privilege expansion, trigger SECURITY DEFINER change, or new table policy.
begin;
CREATE OR REPLACE FUNCTION garments_erp.save_fabric_requirement(p_requirement bigint, p_variant bigint, p_expected jsonb, p_values jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare actual jsonb; fields text[]:=array['fabric_type_id','sub_part_list_id','sub_part_name','lab_dip_id','consumption_per_piece_kg','item_part_fabric_status_id']; incoming garments_erp.item_part_fabric;
begin
 if auth.uid() is null or not garments_access.has_screen_permission('productionItems','edit')
  or not garments_access.has_screen_permission('programs','view') then raise exception 'Fabric planner edit permission required' using errcode='42501';end if;
 perform 1 from garments_erp.variant_item where id=p_variant for update;
 if not found then raise exception 'Select an existing variant part' using errcode='23503';end if;
 if p_requirement is not null then
  select garments_erp.fabric_json('item_part_fabric',to_jsonb(f)) into actual from garments_erp.item_part_fabric f where id=p_requirement and variant_item_id=p_variant for update;
  if actual is null or actual is distinct from p_expected then raise exception 'Fabric requirement changed. Reload before saving.' using errcode='40001';end if;
 elsif p_expected is not null and p_expected<>'null'::jsonb then raise exception 'New requirement cannot have an existing revision';end if;
 if p_values is null or p_values='null'::jsonb then
  delete from garments_erp.item_part_fabric where id=p_requirement;
 else
  if jsonb_typeof(p_values)<>'object' or exists(select 1 from jsonb_object_keys(p_values) k where not k=any(fields)) then raise exception 'Invalid component fields';end if;
  incoming:=jsonb_populate_record(null::garments_erp.item_part_fabric,p_values);
  if p_requirement is null then
   insert into garments_erp.item_part_fabric(variant_item_id,fabric_type_id,sub_part_list_id,sub_part_name,lab_dip_id,consumption_per_piece_kg,item_part_fabric_status_id)
   values(p_variant,incoming.fabric_type_id,incoming.sub_part_list_id,incoming.sub_part_name,incoming.lab_dip_id,incoming.consumption_per_piece_kg,incoming.item_part_fabric_status_id);
  else
   update garments_erp.item_part_fabric set fabric_type_id=incoming.fabric_type_id,sub_part_list_id=incoming.sub_part_list_id,
    sub_part_name=incoming.sub_part_name,lab_dip_id=incoming.lab_dip_id,consumption_per_piece_kg=incoming.consumption_per_piece_kg,
    item_part_fabric_status_id=incoming.item_part_fabric_status_id where id=p_requirement;
  end if;
 end if;
 -- Deferred integrity checks must finish inside the owning command, before returning
 -- to an authenticated caller that deliberately has no private table grants.
 set constraints all immediate;
 return garments_erp.fabric_planner_snapshot();
end $$;

CREATE OR REPLACE FUNCTION garments_erp.set_fabric_plan_dyeing_link(p_requirement bigint, p_program_item bigint, p_linked boolean, p_screen text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if auth.uid() is null or p_screen is null or p_screen not in ('productionItems', 'programs')
      or not garments_access.has_screen_permission(p_screen, 'edit')
      or not garments_access.has_screen_permission('productionItems', 'view')
      or not garments_access.has_screen_permission('programs', 'view') then
    raise exception 'Fabric planner link permission required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(741208531);
  if p_linked then
    insert into garments_erp.fabric_plan_dyeing_link(item_part_fabric_id, dyeing_program_item_id)
      values (p_requirement, p_program_item) on conflict do nothing;
  else
    delete from garments_erp.fabric_plan_dyeing_link
      where item_part_fabric_id = p_requirement and dyeing_program_item_id = p_program_item;
  end if;
  set constraints all immediate;
  return garments_erp.fabric_planner_snapshot();
end $$;
CREATE OR REPLACE FUNCTION garments_erp.fabric_json(p_table text, p_row jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare c record; result jsonb:=p_row;
begin
 for c in select a.attname from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('garments_erp.'||p_table) and a.atttypid='pg_catalog.int8'::pg_catalog.regtype and a.attnum>0 and not a.attisdropped loop
  if result->c.attname is not null and result->c.attname<>'null'::jsonb then result:=jsonb_set(result,array[c.attname],to_jsonb(result->>c.attname));end if;
 end loop;
 if p_table='lab_dip_version' then
  result:=result||coalesce((select jsonb_build_object('date',i.date,'comments',i.comments,'lab_dip_status_id',i.lab_dip_status_id::text)
   from garments_erp.lab_dip_version_item i where i.lab_dip_version_id=(p_row->>'id')::bigint and i.latest),
   jsonb_build_object('date',null,'comments',null,'lab_dip_status_id',null));
 end if;
 if p_table='dyeing_program' then
  result:=result||jsonb_build_object('_program_revision',md5(jsonb_build_object(
   'groups',(select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]'::jsonb) from garments_erp.dyeing_program_lab_dip g where g.dyeing_program_id=(p_row->>'id')::bigint),
   'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from garments_erp.dyeing_program_item i where i.dyeing_program_id=(p_row->>'id')::bigint)
  )::text));
  -- A link-only change must invalidate the reviewed complete set even when updated_at is a no-op.
  result:=result||jsonb_build_object('_planner_links_revision',(
   select md5(coalesce(jsonb_agg(jsonb_build_array(l.item_part_fabric_id::text,l.dyeing_program_item_id::text)
    order by l.item_part_fabric_id,l.dyeing_program_item_id),'[]'::jsonb)::text)
   from garments_erp.fabric_plan_dyeing_link l join garments_erp.dyeing_program_item i on i.id=l.dyeing_program_item_id
   where i.dyeing_program_id=(p_row->>'id')::bigint
  ));
 end if;
 return result;
end $$;
commit;
