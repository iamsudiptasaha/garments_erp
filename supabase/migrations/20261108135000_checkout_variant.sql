begin;
set local lock_timeout = '10s';

-- Keep the legacy column for existing inventory readers and historical values.
-- New costing relationships resolve ownership through variant_item.
alter table garments_erp.raw_material_check_out
  drop constraint raw_material_check_out_item_part_id_fkey,
  add column variant_item_id bigint references garments_erp.variant_item (id);

create index checkout_variant_idx on garments_erp.raw_material_check_out (variant_item_id);

notify pgrst, 'reload schema';
commit;
