-- The guarded command search_path is empty; triggers must still work.
begin;
set local search_path='';
do $$ declare status_id bigint;number text;begin
 insert into garments_erp.yarn_bill_item(yarn_bill_id,yarn_purchase_order_item_id,billed_quantity,billed_rate,billed_bags)
 values((select min(id) from garments_erp.yarn_bill),(select min(id) from garments_erp.yarn_purchase_order_item),1,1,1) returning fabric_status_list_id into status_id;
 if not exists(select 1 from garments_erp.fabric_status_list where id=status_id and name='instock') then raise exception 'Default fabric status failed';end if;
 insert into garments_erp.yarn_purchase_order(yarn_supplier_id) values((select min(id) from garments_erp.yarn_supplier)) returning purchase_order_number into number;
 if number not like 'YPN/%' then raise exception 'PO number generation failed';end if;
 insert into garments_erp.dyeing_program(dyer_id) values((select min(id) from garments_erp.dyer)) returning program_number into number;
 if number not like 'SCD/%' then raise exception 'Dyeing number generation failed';end if;
end $$;
rollback;
