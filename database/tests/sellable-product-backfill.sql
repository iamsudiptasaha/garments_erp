-- Run against the pre-consolidation schema in the disposable CI database.
\set ON_ERROR_STOP on
insert into garments_erp.item_in_store (id, sku, style_code, name, is_active)
values (998001, 'MIGRATION-TEST', 'STYLE', 'Parent name', false);
insert into garments_erp.item_in_store_variation (id, item_in_store_id, name)
values (998002, 998001, 'Child name');
insert into garments_erp.price_type (id, name) values (998001, 'Migration test price');
insert into garments_erp.item_in_store_price
  (id, item_in_store_variation_id, price_type_id, version, price)
values (998003, 998002, 998001, 'v1', 42);

\ir ../../supabase/migrations/20261108090000_sellable_product.sql
\ir ../../supabase/migrations/20261108090000_sellable_product.sql

do $$
begin
  if not exists (
    select 1 from garments_erp.sellable_product
    where id = 998002 and sku = 'MIGRATION-TEST' and style_code = 'STYLE'
      and name = 'Child name' and not is_active and legacy_parent->>'name' = 'Parent name'
  ) or not exists (
    select 1 from garments_erp.item_in_store_price
    where id = 998003 and sellable_product_id = 998002 and price = 42 and version = 'v1'
  ) then
    raise exception 'Sellable product backfill changed identity, metadata or pricing';
  end if;
end;
$$;

delete from garments_erp.item_in_store_price where id = 998003;
delete from garments_erp.price_type where id = 998001;
delete from garments_erp.sellable_product where id = 998002;
