begin;
create or replace function garments_erp.set_default_fabric_status() returns trigger language plpgsql set search_path='' as $$
begin
 if NEW.fabric_status_list_id is null then
  select id into NEW.fabric_status_list_id from garments_erp.fabric_status_list where name='instock';
 end if;
 return NEW;
end $$;
alter function garments_erp.generate_yarn_po_number() set search_path='';
alter function garments_erp.generate_dyeing_program_number() set search_path='';
commit;
