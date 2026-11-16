begin;

-- Only new receipts receive a new code. A material's category determines its
-- series, including for receipts linked to a purchase order.
create function garments_erp.assign_raw_material_receipt_sku()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  category_series bigint;
begin
  if new.raw_material_item_id is null then
    return new;
  end if;
  select c.series into category_series
  from garments_erp.raw_material_item m
  join garments_erp.category_list c on c.id = m.category_list_id
  where m.id = new.raw_material_item_id;
  if category_series is not null then
    if category_series not between 1 and 9 then
      raise exception 'Raw material SKU category series must be between 1 and 9';
    end if;
    new.sku := garments_erp.next_inventory_sku('ACC', category_series::smallint);
  end if;
  return new;
end $$;
create trigger assign_raw_material_receipt_sku
  before insert on garments_erp.raw_material_check_in
  for each row execute function garments_erp.assign_raw_material_receipt_sku();
revoke execute on function garments_erp.assign_raw_material_receipt_sku() from public, anon, authenticated;

commit;
