insert into garments_erp.contact_purpose(id,type) values(900004,'Employee');
insert into garments_erp.contacts(id,company_name) values(900004,'Browser Employee candidate');
insert into garments_erp.lab_dip_version_status(status,sort_order) values
 ('Pending',1),('Reviewed',2),('Revision',3),('Resubmit',4),('Rejected',5),('Approved',6)
 on conflict(sort_order) do nothing;
do $$
declare yarn bigint; supplier bigint; po bigint; poi bigint; ybi bigint; fabric bigint; knit bigint;
 brand bigint; colour bigint; mapping bigint; dyer bigint; lab bigint; version bigint; program bigint; program_item bigint;
begin
 update garments_erp.employee set is_verified=true,verified_by_employee_id=900001 where id=900001;
 insert into garments_erp.yarn_type(name) values('Verification yarn') returning id into yarn;
 insert into garments_erp.yarn_supplier(contacts_id,contact_purpose_id) values(900001,900001) returning id into supplier;
 insert into garments_erp.yarn_purchase_order(yarn_supplier_id) values(supplier) returning id into po;
 insert into garments_erp.yarn_purchase_order_item(purchase_order_number_id,yarn_type_id,quantity,rate) values(po,yarn,1000,10) returning id into poi;
 insert into garments_erp.yarn_bill_item(yarn_bill_id,yarn_purchase_order_item_id,billed_quantity,billed_rate) values(900001,poi,1000,10) returning id into ybi;
 insert into garments_erp.fabric_type(name) values('Verification fabric') returning id into fabric;
 insert into garments_erp.knitting_bill_item(knitting_bill_id,fabric_type_id,yarn_bill_item_id,billed_quantity,consumption,billed_rate) values(900001,fabric,ybi,1000,1000,10) returning id into knit;
 insert into garments_erp.brand_list(brand,contacts_id,contact_purpose_id) values('Verification brand',900001,900001) returning id into brand;
 insert into garments_erp.color_map(name) values('Verification colour') returning id into colour;
 insert into garments_erp.color_map_by_brand(color_map_id,brand_list_id) values(colour,brand) returning id into mapping;
 insert into garments_erp.dyer(contacts_id,contact_purpose_id) values(900001,900001) returning id into dyer;
 insert into garments_erp.lab_dip(edition,color_map_by_brand_id,dyer_id) values(1,mapping,dyer) returning id into lab;
 insert into garments_erp.lab_dip_version(lab_dip_id,version) values(lab,1) returning id into version;
 insert into garments_erp.lab_dip_version_item(lab_dip_version_id,date,lab_dip_status_id) select version,current_date,id from garments_erp.lab_dip_version_status where sort_order=6;
 insert into garments_erp.dyeing_program(dyer_id) values(dyer) returning id into program;
 insert into garments_erp.dyeing_program_item(fabric_type_id,dyeing_program_id,lab_dip_version_id,quantity) values(fabric,program,version,100) returning id into program_item;
end $$;
insert into garments_erp.item (id, style_code) values (982001, 'Billing test');
insert into garments_erp.part_list (id, part) values (982001, 'Billing test body');
insert into garments_erp.item_part (id, item_id, part_list_id) values (982001, 982001, 982001);
insert into garments_erp.size_list (id, size) values (982001, 'Billing test S');
insert into garments_erp.item_size_list (id, item_id, size_list_id) values (982001, 982001, 982001);
insert into garments_erp.production (id, item_part_id) overriding system value values (982001, 982001);
insert into garments_erp.job (id, production_id, stage_id, job_code, latest)
values (982001, 982001, (select id from garments_erp.stage where abbr = 'RTD'), 'BILL-TEST-JOB', true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
insert into garments_erp.item_costing (item_id, version, item_costing_status_id, completed_units)
select 982001, 1, id, 10 from garments_erp.item_costing_status where name = 'draft';
insert into garments_erp.item_costing_item
  (item_costing_id, item_costing_origin_type_id, item_costing_calculation_method_id, description, approved_amount)
select c.id, o.id, m.id, 'Billing fixture', 10 from garments_erp.item_costing c
cross join garments_erp.item_costing_origin_type o
cross join garments_erp.item_costing_calculation_method m
where c.item_id = 982001 and o.name = 'manual' and m.name = 'manual';
update garments_erp.item_costing
set item_costing_status_id = (select id from garments_erp.item_costing_status where name = 'finalized')
where item_id = 982001;
insert into garments_erp.item_produced (id, item_id, completed_job_id, verified_by, request_id)
values (982001, 982001, 982001, 900002, gen_random_uuid());
insert into garments_erp.item_produced_pieces (item_produced_id, item_size_list_id, pieces)
values (982001, 982001, 10);
update garments_erp.item set is_locked = true where id = 982001;

insert into garments_erp.sellable_product (id, sku, name)
values (982001, 'BILLING-TEST', 'Test set');
insert into garments_erp.sellable_unit (sellable_product_id, item_id, item_size_list_id, share_weight)
values (982001, 982001, 982001, 2);
update garments_erp.sellable_product set verified_by_employee_id = 900002 where id = 982001;
insert into garments_erp.price_type (id, name) values (982001, 'Billing test price');
insert into garments_erp.item_in_store_price
  (id, sellable_product_id, price_type_id, version, price)
values (982001, 982001, 982001, 'Billing v1', 120);

insert into garments_erp.gender (id, name) values (982001, 'Billing test gender');
insert into garments_erp.product_type_list (id, product_type, gender_id)
values (982001, 'Billing test product type', 982001);
insert into garments_erp.buyer_list (id, buyer_name) values (982001, 'Billing test buyer');

insert into garments_erp.variant(id,variant_name) values(982001,'Browser variant');
insert into garments_erp.task_board_data(production_id) values(982001);
insert into garments_erp.job_item_status_list(job_id) values(982001);
