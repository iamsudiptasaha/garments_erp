-- Disposable CI fixtures only. Tests retain all original records through rollback.
begin;
do $$
declare b bigint; c bigint; m bigint; dy bigint; lab bigint; other_lab bigint; v1 bigint; v2 bigint; other_v bigint;
 p bigint; source_program bigint; g bigint; source_group bigint; i bigint; source_item bigint;
 ft bigint; part bigint; vi bigint; req bigint; req2 bigint; style bigint; variant bigint; size_id bigint; size bigint;
 yarn bigint; supplier bigint; po bigint; poi bigint; ybi bigint; knit bigint; bill bigint; receipt bigint; batch bigint;
 root_temp text:=gen_random_uuid()::text; root jsonb; result jsonb; expected jsonb; payload jsonb; group_temp text:=gen_random_uuid()::text; item_temp text:=gen_random_uuid()::text;
 n integer;
begin
 insert into garments_erp.lab_dip_version_status(status,sort_order) select 'Failed',3 where not exists(select 1 from garments_erp.lab_dip_version_status where sort_order=3);
 insert into garments_erp.brand_list(brand,contacts_id,contact_purpose_id) values('Edition test',900001,900001) returning id into b;
 insert into garments_erp.color_map(name) values('Edition colour') returning id into c;
 insert into garments_erp.color_map_by_brand(color_map_id,brand_list_id) values(c,b) returning id into m;
 insert into garments_erp.dyer(contacts_id,contact_purpose_id) values(900001,900001) returning id into dy;
 insert into garments_erp.lab_dip(color_map_by_brand_id,dyer_id,edition) values(m,dy,1) returning id into lab;
 insert into garments_erp.lab_dip_version(lab_dip_id,version) values(lab,1) returning id into v1;
 insert into garments_erp.lab_dip_version_item(lab_dip_version_id,date,lab_dip_status_id) select v1,current_date,id from garments_erp.lab_dip_version_status where sort_order=3;
 insert into garments_erp.lab_dip_version(lab_dip_id,version) values(lab,2) returning id into v2;
 insert into garments_erp.lab_dip(color_map_by_brand_id,dyer_id,edition) values(m,dy,2) returning id into other_lab;
 insert into garments_erp.lab_dip_version(lab_dip_id,version) values(other_lab,1) returning id into other_v;
 insert into garments_erp.dyeing_program(dyer_id) values(dy) returning id into p;
 insert into garments_erp.dyeing_program(dyer_id) values(dy) returning id into source_program;
 insert into garments_erp.dyeing_program_lab_dip(dyeing_program_id,lab_dip_id,lab_dip_version_id) values(p,lab,v2) returning id into g;
 insert into garments_erp.dyeing_program_lab_dip(dyeing_program_id,lab_dip_id,lab_dip_version_id) values(source_program,lab,v1) returning id into source_group;
 -- The old version is Failed; the new version has no review. Both editions/versions remain selectable.
 begin
  insert into garments_erp.dyeing_program_lab_dip(dyeing_program_id,lab_dip_id,lab_dip_version_id) values(p,lab,v1);
  raise exception 'TEST duplicate edition accepted';
 exception when unique_violation then null;end;
 begin
  update garments_erp.dyeing_program_lab_dip set lab_dip_version_id=other_v where id=g;
  raise exception 'TEST version/edition mismatch accepted';
 exception when foreign_key_violation then null;end;
 insert into garments_erp.fabric_type(name,series) values('Edition fabric',8) returning id into ft;
 insert into garments_erp.dyeing_program_item(dyeing_program_id,dyeing_program_lab_dip_id,fabric_type_id,quantity)
 values(p,g,ft,90) returning id into i;
 insert into garments_erp.dyeing_program_item(dyeing_program_id,dyeing_program_lab_dip_id,fabric_type_id,quantity)
 values(source_program,source_group,ft,100) returning id into source_item;
 insert into garments_erp.item(style_code,brand_id) values('EDITION-TEST',b) returning id into style;
 insert into garments_erp.part_list(part) values('Edition top') returning id into part;
 insert into garments_erp.item_part(item_id,part_list_id) values(style,part) returning id into part;
 insert into garments_erp.variant(variant_name) values('Shared variant') returning id into variant;
 insert into garments_erp.variant_item(item_part_id,variant_id,lab_dip_id) values(part,variant,other_lab) returning id into vi;
 insert into garments_erp.size_list(size) values('Edition size') returning id into size;
 insert into garments_erp.item_size_list(item_id,size_list_id) values(style,size) returning id into size_id;
 insert into garments_erp.item_cut_ratio(item_size_list_id,pieces) values(size_id,10);
 insert into garments_erp.item_part_fabric(variant_item_id,fabric_type_id,lab_dip_id,sub_part_name,consumption_per_piece_kg)
 values(vi,ft,lab,'Body',0.525) returning id into req;
 insert into garments_erp.item_part_fabric(variant_item_id,fabric_type_id,lab_dip_id,sub_part_name,consumption_per_piece_kg)
 values(vi,ft,lab,'Sleeve',0.125) returning id into req2;
 insert into garments_erp.fabric_plan_dyeing_link values(req,i);
 if not exists(select 1 from garments_erp.view_item_part_fabric_labdip_status where item_part_fabric_id=req and lab_dip_id=lab)
  or (select count(*) from garments_erp.fabric_plan_requirements where id in(req,req2))<>2
 then raise exception 'TEST requirement identity/edition/fanout changed';end if;
 -- Receipt provenance belongs to the output mapping, independently of the selected previous batch.
 insert into garments_erp.yarn_type(name) values('Edition yarn') returning id into yarn;
 insert into garments_erp.yarn_supplier(contacts_id,contact_purpose_id) values(900001,900001) returning id into supplier;
 insert into garments_erp.yarn_purchase_order(yarn_supplier_id) values(supplier) returning id into po;
 insert into garments_erp.yarn_purchase_order_item(purchase_order_number_id,yarn_type_id,quantity,rate) values(po,yarn,100,10) returning id into poi;
 insert into garments_erp.yarn_bill_item(yarn_bill_id,yarn_purchase_order_item_id,billed_quantity,billed_rate) values(900001,poi,100,10) returning id into ybi;
 insert into garments_erp.knitting_bill_item(knitting_bill_id,fabric_type_id,yarn_bill_item_id,billed_quantity,consumption,billed_rate) values(900001,ft,ybi,100,100,10) returning id into knit;
 insert into garments_erp.dyed_fabric_bill(invoice_number,invoice_date) values('Edition receipt',current_date) returning id into bill;
 insert into garments_erp.dyed_fabric_item(dyed_fabric_bill_id,dyeing_program_item_id,knitting_bill_item_id,gross_quantity,billed_quantity,final_quantity,dyeing_rate)
 values(bill,source_item,knit,10,9,8,10) returning id into receipt;
 insert into garments_erp.batch_no_lab_dip_version_map(dyed_fabric_item_id,batch_no,lab_dip_version_id) values(receipt,'EDITION-TEST-BATCH',v1) returning id into batch;
 update garments_erp.dyeing_program_lab_dip set batch_no=batch where id=g;
 set constraints all immediate; -- same edition, different version is valid
 set constraints all deferred;
 begin
  update garments_erp.dyeing_program_lab_dip set batch_no=batch where id=source_group;
  set constraints all immediate;
  raise exception 'TEST own program output accepted';
 exception when check_violation or raise_exception then if sqlerrm='TEST own program output accepted' then raise;end if;end;
 begin
  update garments_erp.dyeing_program_lab_dip set lab_dip_version_id=v2 where id=source_group;
  set constraints all immediate;
  raise exception 'TEST receipt provenance invalidation accepted';
 exception when check_violation or raise_exception then if sqlerrm='TEST receipt provenance invalidation accepted' then raise;end if;end;
 begin
  update garments_erp.dyeing_program_lab_dip set lab_dip_id=other_lab,lab_dip_version_id=other_v where id=g;
  set constraints all immediate;
  raise exception 'TEST different edition batch accepted';
 exception when check_violation or raise_exception then if sqlerrm='TEST different edition batch accepted' then raise;end if;end;

 -- Dates deliberately run opposite to receipt reuse; eligibility has no date rule.
 update garments_erp.dyeing_program set date='2000-01-01' where id=p;
 update garments_erp.dyeing_program set date='2030-01-01' where id=source_program;
 set constraints all immediate;
 set constraints all deferred;
 -- Coordinated updates cannot preserve equality by rewriting both sides.
 begin
  update garments_erp.dyeing_program_lab_dip set lab_dip_version_id=v2 where id=source_group;
  update garments_erp.batch_no_lab_dip_version_map set lab_dip_version_id=v2 where id=batch;
  raise exception 'TEST coordinated provenance rewrite accepted';
 exception when check_violation then null;end;
 begin
  update garments_erp.dyed_fabric_item set dyeing_program_item_id=i where id=receipt;
  raise exception 'TEST receipt reassignment accepted';
 exception when check_violation then null;end;
 begin
  update garments_erp.batch_no_lab_dip_version_map set lab_dip_version_id=v2 where id=batch;
  raise exception 'TEST output version rewrite accepted';
 exception when check_violation then null;end;
 begin
  update garments_erp.batch_no_lab_dip_version_map set batch_no='REWRITTEN' where id=batch;
  raise exception 'TEST output batch rename accepted';
 exception when check_violation then null;end;
 begin
  delete from garments_erp.dyed_fabric_item where id=receipt;
  raise exception 'TEST receipt deletion accepted';
 exception when check_violation then null;end;
 begin
  insert into garments_erp.color_map(name) values('Different historical colour') returning id into c;
  update garments_erp.color_map_by_brand set color_map_id=c where id=m;
  raise exception 'TEST historical colour reassignment accepted';
 exception when check_violation then null;end;
 begin
  delete from garments_erp.batch_no_lab_dip_version_map where id=batch;
  raise exception 'TEST recorded output deletion accepted';
 exception when check_violation then null;end;
 begin
  insert into garments_erp.dyed_fabric_bill(invoice_number,invoice_date) values('Provenance reassignment',current_date) returning id into n;
  update garments_erp.dyed_fabric_item set dyed_fabric_bill_id=n where id=receipt;
  raise exception 'TEST receipt moved to another bill';
 exception when check_violation then null;end;
 -- NULL backfill never invents reuse; source membership is the exact edition.
 if (select source_dyeing_program_id from garments_erp.dyeing_program_lab_dip where id=g) is not null then raise exception 'TEST fabricated historical reuse';end if;
 update garments_erp.dyeing_program_lab_dip set source_dyeing_program_id=source_program,batch_no=null where id=g;
 set constraints all immediate;
 set constraints all deferred;
 begin
  update garments_erp.dyeing_program_lab_dip set source_dyeing_program_id=p where id=source_group;
  set constraints all immediate;
  raise exception 'TEST reuse cycle accepted';
 exception when check_violation then null;end;
 -- Empty groups are permitted only in Draft. Final transition validates at commit.
 insert into garments_erp.dyeing_program_lab_dip(dyeing_program_id,lab_dip_id,lab_dip_version_id) values(p,other_lab,other_v) returning id into n;
 set constraints all immediate;
 set constraints all deferred;
 begin
  update garments_erp.dyeing_program set dyeing_program_status_id=2 where id=p;
  set constraints all immediate;
  raise exception 'TEST empty Final group accepted';
 exception when check_violation then null;end;
 update garments_erp.dyeing_program set dyeing_program_status_id=2 where id=p;
 insert into garments_erp.dyeing_program_item(dyeing_program_id,dyeing_program_lab_dip_id,fabric_type_id,quantity) values(p,n,ft,1);
 set constraints all immediate;
 set constraints all deferred;
 begin
  update garments_erp.dyeing_program set dyeing_program_status_id=null where id=p;
  delete from garments_erp.dyeing_program_item where dyeing_program_lab_dip_id=(select id from garments_erp.dyeing_program_lab_dip where dyeing_program_id=p and lab_dip_id=other_lab);
  set constraints all immediate;
  raise exception 'TEST unclassified empty group accepted';
 exception when check_violation then null;end;
 -- Standalone addition uses the same complete linked set, logs exactly one transition,
 -- detects stale reviews and leaves unlink/manual quantities independent.
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000001"}',true);
 update garments_erp.dyeing_program set dyeing_program_status_id=1 where id=p;
 result:=public.erp_fabric_planner_snapshot();
 if not exists(select 1 from jsonb_array_elements(result->'program_items') r where r->>'dyeing_program_item_id'=i::text and (r->>'quantity')::numeric=90 and (r->>'ordered_kg')::numeric=0)
 then raise exception 'TEST Draft review must show actual ordered quantity, not zero Final coverage';end if;
 begin
  insert into garments_erp.color_map(name) values('Authenticated historical colour rewrite') returning id into c;
  select garments_erp.fabric_json('color_map_by_brand',to_jsonb(cm)) into expected from garments_erp.color_map_by_brand cm where id=m;
  execute 'set local role authenticated';
  perform public.erp_save_fabric_document('colourMappings',jsonb_build_object('table','color_map_by_brand','id',m::text,'before',expected),'edit',
   jsonb_build_array(jsonb_build_object('table','color_map_by_brand','id',m::text,'before',expected,'values',jsonb_build_object('color_map_id',c::text,'brand_list_id',b::text))));
  raise exception 'TEST authenticated historical colour reassignment accepted';
 exception when check_violation then null;end;
 execute 'reset role';
 select jsonb_build_object('program',garments_erp.fabric_json('dyeing_program',to_jsonb(p0)),
  'requirement',(select garments_erp.fabric_json('item_part_fabric',to_jsonb(f)) from garments_erp.item_part_fabric f where id=req2)) into expected from garments_erp.dyeing_program p0 where id=p;
 select count(*) into n from garments_access.app_activity_log;
 execute 'set local role authenticated';
 perform public.erp_set_fabric_plan_dyeing_link(req2,i,true,'productionItems',expected,6.5);
 execute 'reset role';
 if (select quantity from garments_erp.dyeing_program_item where id=i)<>6.5 or (select count(*) from garments_access.app_activity_log)<>n+1 then raise exception 'TEST standalone quantity/activity differs';end if;
 begin
  perform public.erp_set_fabric_plan_dyeing_link(req2,i,false,'programs',expected,5.25);
  raise exception 'TEST stale standalone review accepted';
 exception when serialization_failure then null;end;
 update garments_erp.dyeing_program_item set quantity=88 where id=i;
 select jsonb_build_object('program',garments_erp.fabric_json('dyeing_program',to_jsonb(p0)),
  'requirement',(select garments_erp.fabric_json('item_part_fabric',to_jsonb(f)) from garments_erp.item_part_fabric f where id=req2)) into expected from garments_erp.dyeing_program p0 where id=p;
 perform public.erp_set_fabric_plan_dyeing_link(req2,i,false,'programs',expected,5.25);
 if (select quantity from garments_erp.dyeing_program_item where id=i)<>88 then raise exception 'TEST unlink lost manual override';end if;
 -- A forged/changed total rolls the insertion back atomically.
 select jsonb_build_object('program',garments_erp.fabric_json('dyeing_program',to_jsonb(p0)),
  'requirement',(select garments_erp.fabric_json('item_part_fabric',to_jsonb(f)) from garments_erp.item_part_fabric f where id=req2)) into expected from garments_erp.dyeing_program p0 where id=p;
 begin
  perform public.erp_set_fabric_plan_dyeing_link(req2,i,true,'programs',expected,99);
  raise exception 'TEST changed standalone total accepted';
 exception when serialization_failure then null;end;
 if exists(select 1 from garments_erp.fabric_plan_dyeing_link where item_part_fabric_id=req2 and dyeing_program_item_id=i) then raise exception 'TEST failed link partially persisted';end if;
 -- Permission is checked before private reads/revisions.
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000002"}',true);
 begin
  perform public.erp_set_fabric_plan_dyeing_link(req2,i,true,'programs',expected,6.5);
  raise exception 'TEST viewer linked';
 exception when insufficient_privilege then null;end;
 -- The authenticated atomic document boundary accepts an empty Draft group.
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000001"}',true);
 payload:=jsonb_build_array(
  jsonb_build_object('table','dyeing_program','id',root_temp,'before',null,'values',jsonb_build_object('dyer_id',dy::text,'date',current_date,'dyeing_program_status_id','1')),
  jsonb_build_object('table','dyeing_program_lab_dip','id',group_temp,'before',null,'values',jsonb_build_object('dyeing_program_id',root_temp,'lab_dip_id',lab::text,'lab_dip_version_id',v2::text,'batch_no',null,'source_dyeing_program_id',null)));
 execute 'set local role authenticated';
 result:=public.erp_save_fabric_document('programs',jsonb_build_object('table','dyeing_program','id',root_temp,'before',null),'create',payload);
 execute 'reset role';
 select garments_erp.fabric_json('dyeing_program',to_jsonb(p0)) into expected from garments_erp.dyeing_program p0 where id=(result->>'_saved_id')::bigint;
 if exists(select 1 from garments_erp.dyeing_program_item where dyeing_program_id=(result->>'_saved_id')::bigint) then raise exception 'TEST unexpected Draft line';end if;
 begin
  execute 'set local role authenticated';
  perform public.erp_save_fabric_document('programs',jsonb_build_object('table','dyeing_program','id',result->>'_saved_id','before',expected),'edit',
   jsonb_build_array(jsonb_build_object('table','dyeing_program','id',result->>'_saved_id','before',expected,'values',jsonb_build_object('dyeing_program_status_id','2'))));
  raise exception 'TEST authenticated empty Final accepted';
 exception when check_violation or raise_exception then if sqlerrm='TEST authenticated empty Final accepted' then raise;end if;end;
 execute 'reset role';
 -- Formatting at the 999 boundary preserves prior numbers; counter rows remain transactional.
 update garments_erp.document_number_counter set last_number=998 where document_type='SCD';
 insert into garments_erp.dyeing_program(dyer_id) values(dy) returning id into p;
 if (select program_number from garments_erp.dyeing_program where id=p) not like 'SCD/999/%' then raise exception 'TEST 999 formatting';end if;
 insert into garments_erp.dyeing_program(dyer_id) values(dy) returning id into p;
 if (select program_number from garments_erp.dyeing_program where id=p) not like 'SCD/1000/%' then raise exception 'TEST 1000 truncated';end if;
 set constraints all immediate;
end $$;
rollback;
