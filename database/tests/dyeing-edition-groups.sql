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
 -- Six edition groups, counting editions rather than colour names.
 for n in 3..7 loop
  insert into garments_erp.lab_dip(color_map_by_brand_id,dyer_id,edition) values(m,dy,n) returning id into other_lab;
  insert into garments_erp.lab_dip_version(lab_dip_id,version) values(other_lab,1) returning id into other_v;
  insert into garments_erp.dyeing_program_lab_dip(dyeing_program_id,lab_dip_id,lab_dip_version_id) values(p,other_lab,other_v);
 end loop;
 set constraints all immediate;
 set constraints all deferred;
 begin
  insert into garments_erp.dyeing_program_lab_dip(dyeing_program_id,lab_dip_id,lab_dip_version_id)
   select p,l.id,v.id from garments_erp.lab_dip l join garments_erp.lab_dip_version v on v.lab_dip_id=l.id where l.color_map_by_brand_id=m and l.edition=2;
  set constraints all immediate;
  raise exception 'TEST seventh edition accepted';
 exception when check_violation then null;end;
 -- Existing public command owns revision, authorization and all composite link changes.
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000001"}',true);
 -- Exercise the actual browser database role, not only a postgres session carrying JWT claims.
 select garments_erp.fabric_json('item_part_fabric',to_jsonb(f)) into expected from garments_erp.item_part_fabric f where id=req;
 execute 'set local role authenticated';
 perform public.erp_save_fabric_requirement(req,vi,expected,jsonb_build_object('fabric_type_id',ft::text,'lab_dip_id',lab::text,'sub_part_name','Body','consumption_per_piece_kg',0.525));
 set constraints all immediate;
 execute 'reset role';
 select garments_erp.fabric_json('dyeing_program',to_jsonb(p0)) into expected from garments_erp.dyeing_program p0 where id=p;
 root:=jsonb_build_object('table','dyeing_program','id',p::text,'before',expected);
 payload:=jsonb_build_array(jsonb_build_object('table','fabric_plan_dyeing_link','id',req2||':'||i,'before',null,'values',jsonb_build_object('item_part_fabric_id',req2::text,'dyeing_program_item_id',i::text)));
 result:=public.erp_save_fabric_document('programs',root,'edit',payload);
 if (select quantity from garments_erp.dyeing_program_item where id=i)<>6.5 or (select count(*) from garments_erp.fabric_plan_dyeing_link where dyeing_program_item_id=i)<>2 then raise exception 'TEST complete set quantity/link retention';end if;
 if jsonb_array_length(result->'fabric_plan_dyeing_link')<2 then raise exception 'TEST snapshot omitted existing links';end if;
 begin
  perform public.erp_save_fabric_document('programs',root,'edit',payload);
  raise exception 'TEST stale root accepted';
 exception when serialization_failure then null;end;
 -- A manual edit after recalculation remains legal.
 update garments_erp.dyeing_program_item set quantity=77 where id=i;

 select garments_erp.fabric_json('dyeing_program',to_jsonb(p0)) into expected from garments_erp.dyeing_program p0 where id=p;
 root:=jsonb_build_object('table','dyeing_program','id',p::text,'before',expected);
 update garments_erp.dyeing_program_item set quantity=78 where id=i;
 begin
  perform public.erp_save_fabric_document('programs',root,'edit',jsonb_build_array(jsonb_build_object('table','dyeing_program','id',p::text,'before',expected,'values',jsonb_build_object('dyer_id',dy::text))));
  raise exception 'TEST stale child-only revision accepted';
 exception when serialization_failure then null;end;
 update garments_erp.dyeing_program_item set quantity=77 where id=i;
 perform public.erp_set_fabric_plan_dyeing_link(req2,i,false,'programs',(select jsonb_build_object('program',garments_erp.fabric_json('dyeing_program',to_jsonb(p0)),'requirement',(select garments_erp.fabric_json('item_part_fabric',to_jsonb(f)) from garments_erp.item_part_fabric f where f.id=req2)) from garments_erp.dyeing_program p0 join garments_erp.dyeing_program_item i0 on i0.dyeing_program_id=p0.id where i0.id=i),(select round(coalesce(sum(r.required_kg),0),3) from garments_erp.fabric_plan_requirements r where r.id in(select item_part_fabric_id from garments_erp.fabric_plan_dyeing_link where dyeing_program_item_id=i except select req2)));
 select garments_erp.fabric_json('dyeing_program',to_jsonb(p0)) into expected from garments_erp.dyeing_program p0 where id=p;
 root:=jsonb_build_object('table','dyeing_program','id',p::text,'before',expected);
 payload:=jsonb_build_array(
  jsonb_build_object('table','dyeing_program_item','id',i::text,'before',(select garments_erp.fabric_json('dyeing_program_item',to_jsonb(x)) from garments_erp.dyeing_program_item x where id=i),
   'values',jsonb_build_object('dyeing_program_id',p::text,'dyeing_program_lab_dip_id',g::text,'fabric_type_id',ft::text,'quantity',88,'comments','Reviewed manual override')),
  jsonb_build_object('table','fabric_plan_dyeing_link','id',req2||':'||i,'before',null,'reviewed_required_kg',6.6,
   'values',jsonb_build_object('item_part_fabric_id',req2::text,'dyeing_program_item_id',i::text)));
 begin
  perform public.erp_save_fabric_document('programs',root,'edit',payload);
  raise exception 'TEST stale requirement total accepted';
 exception when serialization_failure then null;end;
 if (select quantity from garments_erp.dyeing_program_item where id=i)<>77 or
  exists(select 1 from garments_erp.fabric_plan_dyeing_link where item_part_fabric_id=req2 and dyeing_program_item_id=i)
 then raise exception 'TEST failed atomic program/link save partially wrote';end if;
 payload:=jsonb_set(payload,'{1,reviewed_required_kg}','6.5'::jsonb);
 perform public.erp_save_fabric_document('programs',root,'edit',payload);
 if (select quantity from garments_erp.dyeing_program_item where id=i)<>88 then raise exception 'TEST subsequent reviewed manual override lost';end if;
 -- Atomic creation resolves temporary root/group/item references without synthetic link IDs.
 payload:=jsonb_build_array(
  jsonb_build_object('table','dyeing_program','id',root_temp,'before',null,'values',jsonb_build_object('dyer_id',dy::text,'date',current_date,'dyeing_program_status_id','1')),
  jsonb_build_object('table','dyeing_program_lab_dip','id',group_temp,'before',null,'values',jsonb_build_object('dyeing_program_id',root_temp,'lab_dip_id',lab::text,'lab_dip_version_id',v2::text,'batch_no',null)),
  jsonb_build_object('table','dyeing_program_item','id',item_temp,'before',null,'values',jsonb_build_object('dyeing_program_id',root_temp,'dyeing_program_lab_dip_id',group_temp,'fabric_type_id',ft::text,'quantity',5.25,'comments','Atomic create')),
  jsonb_build_object('table','fabric_plan_dyeing_link','id',req::text||':'||item_temp,'before',null,'reviewed_required_kg',5.25,'values',jsonb_build_object('item_part_fabric_id',req::text,'dyeing_program_item_id',item_temp)));
 result:=public.erp_save_fabric_document('programs',jsonb_build_object('table','dyeing_program','id',root_temp,'before',null),'create',payload);
 if not exists(select 1 from garments_erp.dyeing_program dp join garments_erp.dyeing_program_item dpi on dpi.dyeing_program_id=dp.id
  join garments_erp.dyeing_program_lab_dip eg on eg.id=dpi.dyeing_program_lab_dip_id
  join garments_erp.fabric_plan_dyeing_link link on link.dyeing_program_item_id=dpi.id
  where dp.id=(result->>'_saved_id')::bigint and dp.dyeing_program_status_id=1 and eg.lab_dip_id=lab and eg.lab_dip_version_id=v2 and dpi.quantity=5.25 and link.item_part_fabric_id=req)
 then raise exception 'TEST atomic group/item/link creation or Draft default failed';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000002"}',true);
 begin
  perform public.erp_save_fabric_document('programs',root,'edit',payload);
  raise exception 'TEST viewer wrote program links';
 exception when insufficient_privilege then null;end;
 set constraints all immediate;
 if (select count(*) from garments_erp.lab_dip where color_map_by_brand_id=m and edition=1)<>1 then raise exception 'TEST duplicate reuse edition';end if;
 if has_table_privilege('authenticated','garments_erp.dyeing_program_lab_dip','INSERT') or has_table_privilege('anon','garments_erp.dyeing_program_lab_dip','SELECT') then raise exception 'TEST group table exposed';end if;
end $$;
rollback;
