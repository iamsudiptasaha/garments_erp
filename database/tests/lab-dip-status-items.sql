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

  insert into garments_erp.lab_dip_version(lab_dip_id, version, date, lab_dip_status_id, comments)
    values (edition_id, 1, date '2026-11-01', initial_status, 'Initial')
    returning id into version_id;

  update garments_erp.lab_dip_version set comments = 'Follow-up', date = date '2026-11-02'
    where id = version_id;
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
    insert into garments_erp.lab_dip_version(lab_dip_id, version, lab_dip_status_id)
      values (edition_id, 2, initial_status);
    raise exception 'TEST: retry allowed without Failed';
  exception when raise_exception then
    if sqlerrm <> 'The latest version must be Failed before adding another version' then raise; end if;
  end;

  update garments_erp.lab_dip_version set lab_dip_status_id = failed_status where id = version_id;
  insert into garments_erp.lab_dip_version(lab_dip_id, version, lab_dip_status_id)
    values (edition_id, 2, initial_status);
end;
$$;
rollback;
