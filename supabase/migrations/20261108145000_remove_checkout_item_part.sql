begin;
set local lock_timeout = '10s';

alter table garments_erp.raw_material_check_out
  drop column item_part_id;

notify pgrst, 'reload schema';
commit;
