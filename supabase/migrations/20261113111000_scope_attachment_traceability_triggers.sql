-- A private image link does not change a Lab Dip or Item traceability relationship.
-- Keep the existing deferred validation for every other write.
drop trigger check_lab_dip_traceability on garments_erp.lab_dip_version;
create constraint trigger check_lab_dip_traceability
  after insert or delete on garments_erp.lab_dip_version
  deferrable initially deferred for each row
  execute function garments_erp.check_lab_dip_traceability();
create constraint trigger check_lab_dip_traceability_update
  after update on garments_erp.lab_dip_version
  deferrable initially deferred for each row
  when ((to_jsonb(old) - 'shade_card_image_attachment' - 'updated_at')
    is distinct from (to_jsonb(new) - 'shade_card_image_attachment' - 'updated_at'))
  execute function garments_erp.check_lab_dip_traceability();

drop trigger check_lab_dip_traceability on garments_erp.item;
create constraint trigger check_lab_dip_traceability
  after insert or delete on garments_erp.item
  deferrable initially deferred for each row
  execute function garments_erp.check_lab_dip_traceability();
create constraint trigger check_lab_dip_traceability_update
  after update on garments_erp.item
  deferrable initially deferred for each row
  when ((to_jsonb(old) - 'image_attachment' - 'updated_at')
    is distinct from (to_jsonb(new) - 'image_attachment' - 'updated_at'))
  execute function garments_erp.check_lab_dip_traceability();
