-- REVIEW DRAFT ONLY. Not applied to Supabase.
-- The misc diagram points receipts to a PO item; the live schema currently
-- has purchase_order_id pointing at the PO header. Retain that legacy column
-- during a transition; do not rename date/quantity/price in this change.
begin;
alter table garments_erp.raw_material_check_in
  add column raw_material_purchase_order_item_id bigint
  references garments_erp.raw_material_purchase_order_item(id);
create index raw_material_check_in_order_item_idx
  on garments_erp.raw_material_check_in(raw_material_purchase_order_item_id);
-- Only backfill unambiguous matches. Unmatched/ambiguous historical receipts
-- require review before making the new relationship mandatory for PO receipts.
with matches as (
  select receipt.id, min(line.id) as line_id
  from garments_erp.raw_material_check_in receipt
  join garments_erp.raw_material_purchase_order_item line
    on line.raw_material_purchase_order_id = receipt.purchase_order_id
   and line.raw_material_item_id = receipt.raw_material_item_id
  where receipt.dyed_fabric_item_id is null
  group by receipt.id having count(*) = 1
)
update garments_erp.raw_material_check_in receipt
set raw_material_purchase_order_item_id = matches.line_id
from matches where receipt.id = matches.id;
commit;
-- raw_material_supplier_list_id is already nullable. No ALTER is needed.
-- Live transactional saves must enforce matching PO/header/item/supplier and
-- null PO/supplier for fabric receipts. This draft alone is not that live API.
