-- Run only in an isolated database at the migration immediately preceding
-- production_hub_and_review_ownership, after the synthetic CI seed.
begin;
update garments_erp.employee set verified_by_employee_id=900001 where id=900002;
insert into garments_erp.item_status_list(id,status) overriding system value values(980001,'Backfill status');
insert into garments_erp.stage_type(id,name) overriding system value values(980001,'Backfill stage type');
insert into garments_erp.stage(id,name,abbr,sort_order,stage_type_id) overriding system value values(980001,'Backfill cutting','BCUT',1,980001),(980002,'Backfill sewing','BSEW',2,980001);
insert into garments_erp.item(id,style_code) overriding system value values(980001,'Backfill item');
insert into garments_erp.part_list(id,part) overriding system value values(980001,'Backfill part');
insert into garments_erp.item_part(id,item_id,part_list_id) overriding system value values(980001,980001,980001);
insert into garments_erp.job(id,item_part_id,stage_id,verify_employee_id,item_status_list_id,job_code,start_date,complete_date)
 values(980001,980001,980001,900001,980001,'BCUT/98001/26-27','2026-11-01','2026-11-02'),
 (980002,980001,980002,900001,980001,'BSEW/98002/26-27','2026-11-02',null);
insert into garments_erp.job_assignees(job_id,assigned_employees_id) overriding system value values(980001,900001),(980002,900001),(980002,900002);
insert into garments_erp.brand_list(id,brand,contacts_id,contact_purpose_id) overriding system value values(980001,'Backfill brand',900001,900001);
insert into garments_erp.dyer(id,contacts_id,contact_purpose_id) overriding system value values(980001,900001,900001);
insert into garments_erp.color_map(id,name) overriding system value values(980001,'Backfill blue');
insert into garments_erp.color_map_by_brand(id,color_map_id,brand_list_id) overriding system value values(980001,980001,980001);
insert into garments_erp.lab_dip(id,edition,color_map_by_brand_id,dyer_id) overriding system value values(980001,1,980001,980001);
insert into garments_erp.lab_dip_version_status(id,status,sort_order) overriding system value values(980001,'Failed',3);
insert into garments_erp.lab_dip_version(id,lab_dip_id,version,date,comments,lab_dip_status_id) overriding system value values(980001,980001,1,'2026-11-01','Preserve review',980001);
insert into garments_erp.unit_of_measure(id,unit) overriding system value values(980001,'Backfill kg');
insert into garments_erp.category_list(id,name) overriding system value values(980001,'Backfill material category');
insert into garments_erp.raw_material_item(id,name,category_list_id,unit_of_measure_id) overriding system value values(980001,'Backfill material',980001,980001);
insert into garments_erp.raw_material_supplier_list(id,contacts_id,contact_purpose_id) overriding system value values(980001,900001,900001);
insert into garments_erp.raw_material_purchase_order(id,purchase_order_number,raw_material_supplier_list_id) overriding system value values(980001,'BACKFILL-PO',980001);
insert into garments_erp.raw_material_purchase_order_item(id,raw_material_purchase_order_id,raw_material_item_id,quantity) overriding system value values(980001,980001,980001,10);
insert into garments_erp.raw_material_check_in(id,raw_material_item_id,date,quantity,price,purchase_order_id,raw_material_supplier_list_id,raw_material_purchase_order_item_id)
 values(980001,980001,'2026-11-02',7,15.5,980001,980001,980001);
insert into garments_erp.yarn_type(id,name,yarn_count) values(980001,'Backfill cotton','30s');
insert into garments_erp.yarn_supplier(id,contacts_id,contact_purpose_id) values(980001,900001,900001);
insert into garments_erp.yarn_purchase_order(id,purchase_order_number,yarn_supplier_id) values(980001,'BACKFILL-YARN-PO',980001);
insert into garments_erp.yarn_purchase_order_item(id,purchase_order_number_id,yarn_type_id) values(980001,980001,980001);
insert into garments_erp.yarn_bill_item(id,yarn_bill_id,yarn_purchase_order_item_id) values(980001,900001,980001);
insert into garments_erp.fabric_type(id,name) values(980001,'Backfill jersey');
insert into garments_erp.knitting_bill_item(id,knitting_bill_id,yarn_bill_item_id,fabric_type_id) values(980001,900001,980001,980001);
insert into garments_erp.dyeing_program(id,program_number,dyer_id) values(980001,'BACKFILL-DYE',980001);
insert into garments_erp.dyeing_program_item(id,dyeing_program_id,fabric_type_id,lab_dip_version_id) values(980001,980001,980001,980001);
insert into garments_erp.dyed_fabric_bill(id,invoice_number) values(980001,'BACKFILL-DYE-BILL');
insert into garments_erp.dyed_fabric_item(id,dyed_fabric_bill_id,dyeing_program_item_id,knitting_bill_item_id) values(980001,980001,980001,980001);
insert into garments_erp.batch_no_lab_dip_version_map(id,dyed_fabric_item_id,batch_no,lab_dip_version_id) overriding system value values(980001,980001,'BATCH-TEXT-980001',980001);
insert into garments_erp.dyeing_program_item(id,dyeing_program_id,fabric_type_id,lab_dip_version_id,batch_no) values(980002,980001,980001,980001,'BATCH-TEXT-980001');
commit;
