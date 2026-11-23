-- Only run by the fixed local CI runner, immediately before the edition-group migration.
begin;
create table public.ci_edition_backfill_fixture(data jsonb not null);
do $$ declare contact bigint; purpose bigint; dyer bigint; brand bigint; colour bigint; mapping bigint; lab bigint; v1 bigint; v2 bigint; program bigint; fabric bigint; first_item bigint; second_item bigint; failed bigint;begin
 insert into garments_erp.contact_purpose(type) values('Edition backfill fixture') returning id into purpose;
 insert into garments_erp.contacts(company_name) values('Edition backfill fixture') returning id into contact;
 insert into garments_erp.dyer(contacts_id,contact_purpose_id) values(contact,purpose) returning id into dyer;
 insert into garments_erp.brand_list(brand,contacts_id,contact_purpose_id) values('Edition backfill fixture',contact,purpose) returning id into brand;
 insert into garments_erp.color_map(name) values('Edition backfill fixture') returning id into colour;
 insert into garments_erp.color_map_by_brand(color_map_id,brand_list_id) values(colour,brand) returning id into mapping;
 insert into garments_erp.lab_dip(color_map_by_brand_id,dyer_id,edition) values(mapping,dyer,1) returning id into lab;
 insert into garments_erp.lab_dip_version_status(status,sort_order) values('Failed',3) returning id into failed;
 insert into garments_erp.lab_dip_version(lab_dip_id,version) values(lab,1) returning id into v1;
 insert into garments_erp.lab_dip_version_item(lab_dip_version_id,date,lab_dip_status_id) values(v1,current_date,failed);
 insert into garments_erp.lab_dip_version(lab_dip_id,version) values(lab,2) returning id into v2;
 insert into garments_erp.dyeing_program(dyer_id) values(dyer) returning id into program;
 insert into garments_erp.fabric_type(name) values('Edition backfill fixture') returning id into fabric;
 insert into garments_erp.dyeing_program_item(dyeing_program_id,fabric_type_id,lab_dip_version_id,quantity) values(program,fabric,v1,1) returning id into first_item;
 insert into garments_erp.dyeing_program_item(dyeing_program_id,fabric_type_id,lab_dip_version_id,quantity) values(program,fabric,v2,2) returning id into second_item;
 insert into public.ci_edition_backfill_fixture values(jsonb_build_object('contact',contact,'purpose',purpose,'dyer',dyer,'brand',brand,'colour',colour,'mapping',mapping,'lab',lab,'v1',v1,'v2',v2,'program',program,'fabric',fabric,'first',first_item,'second',second_item,'failed',failed));
end $$;
commit;
