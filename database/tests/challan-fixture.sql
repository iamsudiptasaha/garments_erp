-- Local fixtures used by RPC and browser checks. Caller owns the transaction.
insert into garments_erp.item(id,style_code) values (974001,'CHALLAN-TEST');
insert into garments_erp.part_list(id,part) values (974001,'Test body');
insert into garments_erp.item_part(id,item_id,part_list_id) values (974001,974001,974001);
insert into garments_erp.size_list(id,size,sort_order) values (974001,'Test S',974001),(974002,'Test M',974002);
insert into garments_erp.item_size_list(id,item_id,size_list_id) values (974001,974001,974001),(974002,974001,974002);
insert into garments_erp.variant(id,variant_name) values (974001,'Test Indigo');
insert into garments_erp.variant_item(id,item_part_id,variant_id) values (974001,974001,974001);
insert into garments_erp.stage_type(id,name) values (974001,'Test challan stage type');
insert into garments_erp.stage(id,name,abbr,sort_order,stage_type_id,track_pieces,pp_stage)
  values (974001,'Test cutting','TCH',974001,974001,true,false);
insert into garments_erp.job_worker(id,contacts_id,contact_purpose_id)
  values (974001,900001,900001),(974002,900002,900001);
insert into garments_erp.production(id,item_part_id) overriding system value values (974001,974001);
insert into garments_erp.job(id,production_id,stage_id,job_worker_id,job_code,latest)
  values (974001,974001,974001,974001,'TEST-JOB',true),
         (974002,974001,974001,974002,'OTHER-WORKER',false);
insert into garments_erp.task_board_data(production_id) values (974001);
insert into garments_erp.job_item_status_list(job_id) values (974001),(974002);
insert into garments_erp.variant_item_per_job(id,job_id,variant_item_id)
  values (974001,974001,974001),(974002,974002,974001);
insert into garments_erp.stage_pieces(variant_item_per_job_id,item_size_list_id,pieces_stock_in)
  values (974001,974001,24),(974001,974002,8),(974002,974001,24),(974002,974002,8);
