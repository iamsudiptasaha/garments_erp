-- Synthetic isolated-database fixtures only. Caller controls transaction/rollback.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000001"}',false);
insert into garments_erp.category_list(id,type,name) values(995001,'Accessory','Transferable test');
insert into garments_erp.unit_of_measure(id,unit) values(995001,'piece');
insert into garments_erp.raw_material_item(id,name,unit_of_measure_id,category_list_id) values(995001,'Transferable template set',995001,995001);
insert into garments_erp.raw_material_supplier_list(id,contact_purpose_id,contacts_id) values(995001,900001,900001);
insert into garments_erp.raw_material_purchase_order(id,purchase_order_number,raw_material_supplier_list_id) values(995001,'TRANSFER-TEST-PO',995001);
insert into garments_erp.raw_material_purchase_order_item(id,raw_material_purchase_order_id,raw_material_item_id,quantity,price)
 values(995001,995001,995001,100,25);
insert into garments_erp.job_worker(id,contact_purpose_id,contacts_id) values(995001,900001,900001),(995002,900001,900002);
insert into garments_erp.item(id,style_code,product_description) values(995001,'TR-204','Cotton overshirt');
insert into garments_erp.check_out_type(id,name) values(995001,'Transfer test ordinary consumption');
insert into garments_erp.raw_material_check_in(id,sku,inward_date,billed_quantity,raw_material_item_id,raw_material_purchase_order_item_id,is_transferable)
 values(995001,'TR-RECEIPT-1',current_date,12,995001,995001,true),
 (995002,'TR-RECEIPT-2',current_date,1,995001,995001,true),
 (995003,'TR-RECEIPT-3',current_date,20,995001,995001,false),
 (995004,'TR-RECEIPT-4',current_date,1,995001,995001,false);
