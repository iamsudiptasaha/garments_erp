-- Run after the status-items migration. Fixtures are rolled back.
begin;
do $$
declare
  purpose_id bigint;
  contact_id bigint;
  brand_id bigint;
  dyer_id bigint;
  colour_id bigint;
  mapping_id bigint;
  edition_id bigint;
  version_id bigint;
  initial_status bigint;
  failed_status bigint;
  approved_status bigint;
  review_id bigint;
  root jsonb;
  prior jsonb;
  result jsonb;
begin
  insert into garments_erp.contact_purpose(type) values ('Status items test') returning id into purpose_id;
  insert into garments_erp.contacts(company_name) values ('Status items test') returning id into contact_id;
  insert into garments_erp.brand_list(contacts_id, contact_purpose_id, brand)
    values (contact_id, purpose_id, 'Status items test') returning id into brand_id;
  insert into garments_erp.dyer(contacts_id, contact_purpose_id)
    values (contact_id, purpose_id) returning id into dyer_id;
  insert into garments_erp.color_map(name) values ('Status items test') returning id into colour_id;
  insert into garments_erp.color_map_by_brand(color_map_id, brand_list_id)
    values (colour_id, brand_id) returning id into mapping_id;
  insert into garments_erp.lab_dip(edition, color_map_by_brand_id, dyer_id)
    values (1, mapping_id, dyer_id) returning id into edition_id;

  insert into garments_erp.lab_dip_version_status(status, sort_order)
    values ('At Dyer', 1), ('Failed', 3) on conflict (sort_order) do nothing;
  select id into strict initial_status from garments_erp.lab_dip_version_status where sort_order = 1;
  select id into strict failed_status from garments_erp.lab_dip_version_status where sort_order = 3;

  insert into garments_erp.lab_dip_version(lab_dip_id, version)
    values (edition_id, 1)
    returning id into version_id;

  insert into garments_erp.lab_dip_version_item(lab_dip_version_id, date, lab_dip_status_id, comments)
    values (version_id, date '2026-11-01', initial_status, 'Initial'),
      (version_id, date '2026-11-02', initial_status, 'Follow-up');
  update garments_erp.lab_dip_version set shade_card_no = 'SC-1' where id = version_id;

  if (select count(*) from garments_erp.lab_dip_version_item where lab_dip_version_id = version_id) <> 2
    or not exists (select 1 from garments_erp.lab_dip_version_item
      where lab_dip_version_id = version_id and latest and date = date '2026-11-02'
        and comments = 'Follow-up' and lab_dip_status_id = initial_status)
    or not exists (select 1 from garments_erp.lab_dip_version_item
      where lab_dip_version_id = version_id and not latest and comments = 'Initial') then
    raise exception 'Status history failed to preserve the dated comment update';
  end if;

  begin
    insert into garments_erp.lab_dip_version(lab_dip_id, version)
      values (edition_id, 2);
    raise exception 'TEST: retry allowed without Failed';
  exception when raise_exception then
    if sqlerrm <> 'The latest version must be Failed before adding another version' then raise; end if;
  end;

  insert into garments_erp.lab_dip_version_item(lab_dip_version_id, lab_dip_status_id) values(version_id, failed_status);
  insert into garments_erp.lab_dip_version(lab_dip_id, version)
    values (edition_id, 2) returning id into version_id;

  -- The existing Fabric RPC must write review rows without physical parent fields.
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"10000000-0000-4000-8000-000000000001"}',true);
  select garments_access.fabric_json('lab_dip',to_jsonb(l)) into root from garments_erp.lab_dip l where id=edition_id;
  select garments_access.fabric_json('lab_dip_version',to_jsonb(v)) into prior from garments_erp.lab_dip_version v where id=version_id;
  result:=public.erp_save_fabric_document('labDips',jsonb_build_object('table','lab_dip','id',edition_id::text,'before',root),'edit',
   jsonb_build_array(jsonb_build_object('table','lab_dip_version','id',version_id::text,'before',prior,'values',
    jsonb_build_object('lab_dip_id',edition_id::text,'version',2,'date','2026-11-03','comments','Through legacy RPC',
     'lab_dip_status_id',initial_status::text,'attached_swatch',false,'shade_card_no','SC-2','shade_card_option',null))));
  if not exists(select 1 from garments_erp.lab_dip_version_item where lab_dip_version_id=version_id and latest and comments='Through legacy RPC') then
   raise exception 'Legacy RPC did not write the owning review table';
  end if;
  select id into strict review_id from garments_erp.lab_dip_version_item where lab_dip_version_id=version_id and latest;
  begin
   update garments_erp.lab_dip_version_item set comments='Overwrite' where id=review_id;
   raise exception 'TEST: submitted review mutable';
  exception when raise_exception then
   if sqlerrm<>'Submitted reviews cannot be edited or deleted; add a review' then raise;end if;
  end;
  insert into garments_erp.lab_dip_version_status(status,sort_order) values('Approved',6) on conflict(sort_order) do nothing;
  select id into strict approved_status from garments_erp.lab_dip_version_status where sort_order=6;
  perform public.erp_add_lab_dip_review(version_id,approved_status,'2026-11-04','Approved through child API',review_id);
  if not exists(select 1 from garments_erp.view_default_lab_dip_version where lab_dip_version_id=version_id and date='2026-11-04') then
   raise exception 'Default view did not read the child review';
  end if;
  begin
   perform public.erp_add_lab_dip_review(version_id,initial_status,'2026-11-05','Stale overwrite',review_id);
   raise exception 'TEST: stale child review accepted';
  exception when serialization_failure then null;end;
  begin
   insert into garments_erp.lab_dip_version_item(lab_dip_version_id,lab_dip_status_id) values(version_id,initial_status);
   raise exception 'TEST: approved edition allowed further review';
  exception when raise_exception then
   if sqlerrm<>'This edition is complete. Create a new edition for further attempts' then raise;end if;
  end;
end;
$$;
rollback;
