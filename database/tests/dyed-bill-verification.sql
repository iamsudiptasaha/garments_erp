-- Disposable synthetic database only; all business fixtures roll back.
begin;
do $$
declare style bigint; body_type bigint; sleeve_type bigint; body bigint; sleeve bigint; size_type bigint; size bigint; variant bigint; sleeve_design bigint;
 body_variant bigint; sleeve_variant bigint; body_requirement bigint; sleeve_requirement bigint;
 yarn bigint; supplier bigint; po bigint; poi bigint; ybi bigint; fabric bigint; knit bigint;
 brand bigint; colour bigint; mapping bigint; dyer bigint; lab bigint; version bigint; program bigint; program_item bigint; alternate_program bigint; alternate_line bigint;
 payload jsonb; edit_payload jsonb; invalid_payload jsonb; proof uuid; result jsonb; root jsonb; saved_id bigint;
 actor uuid:='00000000-0000-4000-8000-000000000001'; claims jsonb;
 header_temp text:=gen_random_uuid()::text; line_temp text:=gen_random_uuid()::text; batch_temp text:=gen_random_uuid()::text;
begin
 update garments_erp.employee_status set is_verified=true,verified_by_employee_id=900001 where employee_id=900001;
 insert into garments_erp.yarn_type(name) values('Verification yarn') returning id into yarn;
 insert into garments_erp.yarn_supplier(contacts_id,contact_purpose_id) values(900001,900001) returning id into supplier;
 insert into garments_erp.yarn_purchase_order(yarn_supplier_id) values(supplier) returning id into po;
 insert into garments_erp.yarn_purchase_order_item(purchase_order_number_id,yarn_type_id,quantity,rate) values(po,yarn,1000,10) returning id into poi;
 insert into garments_erp.yarn_bill_item(yarn_bill_id,yarn_purchase_order_item_id,billed_quantity,billed_rate) values(900001,poi,1000,10) returning id into ybi;
 insert into garments_erp.fabric_type(name,series) values('Verification fabric',9) returning id into fabric;
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
 insert into garments_erp.item(style_code,brand_id) values('Fabric planner verification',brand) returning id into style;
 insert into garments_erp.part_list(part) values('Planner body') returning id into body_type;
 insert into garments_erp.part_list(part) values('Planner sleeve') returning id into sleeve_type;
 insert into garments_erp.item_part(item_id,part_list_id) values(style,body_type) returning id into body;
 insert into garments_erp.item_part(item_id,part_list_id,parent_item_part_id)
 values(style,sleeve_type,body) returning id into sleeve;
 begin
  update garments_erp.item_part set parent_item_part_id=sleeve where id=body;
  raise exception 'TEST accepted cyclic part';
 exception when check_violation then null;end;
 begin
  insert into garments_erp.production(item_part_id) values(sleeve);
  raise exception 'TEST accepted dependent production';
 exception when check_violation then null;end;
 insert into garments_erp.size_list(size) values('Planner size') returning id into size_type;
 insert into garments_erp.item_size_list(item_id,size_list_id) values(style,size_type) returning id into size;
 insert into garments_erp.item_cut_ratio(item_size_list_id,pieces) values(size,10);
 insert into garments_erp.variant(variant_name) values('Planner variant') returning id into variant;
 insert into garments_erp.variant_item(item_part_id,variant_id,lab_dip_id)
 values(body,variant,lab) returning id into body_variant;
 insert into garments_erp.variant(variant_name) values('Sleeve variant') returning id into sleeve_design;
 insert into garments_erp.variant_item(item_part_id,variant_id,lab_dip_id)
 values(sleeve,sleeve_design,lab) returning id into sleeve_variant;
 insert into garments_erp.item_part_fabric(variant_item_id,fabric_type_id,consumption_per_piece_kg)
 values(body_variant,fabric,0.525) returning id into body_requirement;
 insert into garments_erp.item_part_fabric(variant_item_id,fabric_type_id,consumption_per_piece_kg)
 values(sleeve_variant,fabric,0.3125) returning id into sleeve_requirement;
 insert into garments_erp.fabric_plan_dyeing_link(item_part_fabric_id,dyeing_program_item_id)
 values(body_requirement,program_item),(sleeve_requirement,program_item);
 begin
  update garments_erp.variant_item set lab_dip_id=null where id=sleeve_variant;
  raise exception 'TEST accepted an incompatible lab dip';
 exception when check_violation then null;end;
 claims:=jsonb_build_object('sub',actor,'aal','aal2','session_id','10000000-0000-4000-8000-000000000001','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now()))));
 perform set_config('request.jwt.claim.sub',actor::text,true);perform set_config('request.jwt.claims',claims::text,true);
 if not exists(select 1 from jsonb_array_elements(public.erp_fabric_planner_snapshot()->'variants') v
   where v->>'id'=sleeve_variant::text and v->>'parent_id'=body::text)
 then raise exception 'TEST planner RPC lost dependent part';end if;
 perform public.erp_save_fabric_requirement(sleeve_variant,fabric,0.3125,0.4);
 perform public.erp_save_fabric_requirement(sleeve_variant,fabric,0.4,0.3125);
 perform public.erp_set_fabric_plan_dyeing_link(sleeve_requirement,program_item,false,'programs');
 perform public.erp_set_fabric_plan_dyeing_link(sleeve_requirement,program_item,true,'productionItems');
 payload:=jsonb_build_object('resource','dyeBills','action','create','root',jsonb_build_object('table','dyed_fabric_bill','id',header_temp,'before',null),'changes',jsonb_build_array(
 jsonb_build_object('table','dyed_fabric_bill','id',header_temp,'before',null,'values',jsonb_build_object('invoice_number','VERIFY-CREATE','invoice_date',current_date)),
 jsonb_build_object('table','dyed_fabric_item','id',line_temp,'before',null,'values',jsonb_build_object('dyed_fabric_bill_id',header_temp,'dyeing_program_item_id',program_item::text,'knitting_bill_item_id',knit::text,'gross_quantity',10,'billed_quantity',9,'final_quantity',8,'dyeing_rate',10,'dyeing_rolls',1)),
 jsonb_build_object('table','batch_no_lab_dip_version_map','id',batch_temp,'before',null,'values',jsonb_build_object('dyed_fabric_item_id',line_temp,'batch_no','VERIFY-BATCH','lab_dip_version_id',version::text))));
 begin perform public.erp_save_fabric_document('dyeBills',payload->'root','create',payload->'changes');raise exception 'TEST generic bypass';exception when insufficient_privilege then null;end;
 begin perform public.erp_save_verified_dyed_bill(payload,null);raise exception 'TEST missing proof';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',(claims||jsonb_build_object('amr','[]'::jsonb))::text,true);
 begin perform public.erp_dyed_bill_attestation(actor,900001,payload);raise exception 'TEST missing fresh password';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',claims::text,true);
 begin perform public.erp_dyed_bill_attestation(actor,900002,payload);raise exception 'TEST mismatched employee';exception when insufficient_privilege then null;end;
 proof:=public.erp_dyed_bill_attestation(actor,900001,payload);
 begin perform public.erp_save_verified_dyed_bill(payload||'{"action":"edit"}',proof);raise exception 'TEST changed payload';exception when insufficient_privilege then null;end;
 result:=public.erp_save_verified_dyed_bill(payload,proof);
 select value into root from jsonb_array_elements(result->'dyed_fabric_bill') where value->>'invoice_number'='VERIFY-CREATE';
 saved_id:=(root->>'id')::bigint;
 if saved_id is null or root->>'verified_by_employee_id'<>'900001' then raise exception 'TEST missing verifier';end if;
 if not exists(select 1 from garments_erp.batch_no_lab_dip_version_map where batch_no='VERIFY-BATCH') then raise exception 'TEST missing atomic batch';end if;
 if not exists (
  select 1 from garments_erp.raw_material_check_in r
  join garments_erp.dyed_fabric_item d on d.id=r.dyed_fabric_item_id
  where d.dyed_fabric_bill_id=saved_id and r.automatic_dyed_receipt and r.sku like 'FAB-9___'
    and r.billed_quantity=8 and r.billed_price=33 and r.invoice_number='VERIFY-CREATE'
    and r.verified_by_employee_id=900001 and r.raw_material_item_id is null
    and r.raw_material_purchase_order_item_id is null
 ) then raise exception 'TEST missing automatic receipt at final quantity and preview price';end if;
 if not exists(select 1 from garments_erp.fabric_plan_estimates where id=sleeve_requirement
     and root_item_part_id=body and planned_pieces=10 and required_kg=3.125
     and estimated_ordered_kg=3.125 and estimated_received_kg=3.125)
    or not exists(select 1 from garments_erp.fabric_plan_estimates where id=body_requirement
      and required_kg=5.25 and estimated_received_kg=4.875 and receipt_shortage_kg=0.375)
    or not exists(select 1 from garments_erp.fabric_plan_dyeing_surplus
      where dyeing_program_item_id=program_item and received_kg=8 and received_surplus_kg=0)
 then raise exception 'TEST inherited fractional demand and shared coverage';end if;
 update garments_erp.dyeing_program_item set quantity=3 where id=program_item;
 insert into garments_erp.dyeing_program(dyer_id) values(dyer) returning id into alternate_program;
 insert into garments_erp.dyeing_program_item(fabric_type_id,dyeing_program_id,lab_dip_version_id,quantity)
 values(fabric,alternate_program,version,2.5) returning id into alternate_line;
 insert into garments_erp.fabric_plan_dyeing_link(item_part_fabric_id,dyeing_program_item_id)
 values(body_requirement,alternate_line);
 if not exists(select 1 from garments_erp.fabric_plan_estimates where id=body_requirement
     and estimated_ordered_kg=5.25 and order_shortage_kg=0)
    or not exists(select 1 from garments_erp.fabric_plan_estimates where id=sleeve_requirement
      and estimated_ordered_kg=0.25)
 then raise exception 'TEST full coverage should precede partial coverage when supplies overlap';end if;
 begin perform public.erp_save_verified_dyed_bill(payload,proof);raise exception 'TEST reused proof';exception when insufficient_privilege then null;end;
 edit_payload:=jsonb_build_object('resource','dyeBills','action','edit','root',jsonb_build_object('table','dyed_fabric_bill','id',saved_id::text,'before',root),'changes',jsonb_build_array(jsonb_build_object('table','dyed_fabric_bill','id',saved_id::text,'before',root,'values',jsonb_build_object('invoice_number','VERIFY-EDIT','invoice_date',current_date))));
 invalid_payload:=jsonb_set(edit_payload,'{changes}',(edit_payload->'changes')||jsonb_build_array(jsonb_build_object('table','contacts','id',gen_random_uuid()::text,'before',null,'values',jsonb_build_object('company_name','FORBIDDEN'))));
 proof:=public.erp_dyed_bill_attestation(actor,900001,invalid_payload);
 begin perform public.erp_save_verified_dyed_bill(invalid_payload,proof);raise exception 'TEST invalid linked write';exception when raise_exception then if sqlerrm='TEST invalid linked write' then raise;end if;end;
 if (select invoice_number from garments_erp.dyed_fabric_bill where id=saved_id)<>'VERIFY-CREATE' or (select used_at from garments_erp.dyed_bill_attestation where id=proof) is not null then raise exception 'TEST partial bill or proof consumption after failure';end if;
 proof:=public.erp_dyed_bill_attestation(actor,900001,edit_payload);
 update garments_erp.dyed_bill_attestation set expires_at=now()-interval '1 second' where id=proof;
 begin perform public.erp_save_verified_dyed_bill(edit_payload,proof);raise exception 'TEST expired proof';exception when insufficient_privilege then null;end;
 proof:=public.erp_dyed_bill_attestation(actor,900001,edit_payload);
 perform public.erp_save_verified_dyed_bill(edit_payload,proof);
 if (select count(*) from garments_erp.raw_material_check_in r
     join garments_erp.dyed_fabric_item d on d.id=r.dyed_fabric_item_id
     where d.dyed_fabric_bill_id=saved_id) <> 1
    or not exists(select 1 from garments_erp.raw_material_check_in
      where automatic_dyed_receipt and invoice_number='VERIFY-EDIT')
 then raise exception 'TEST receipt sync duplicated or did not update the original';end if;
 proof:=public.erp_dyed_bill_attestation(actor,900001,edit_payload);
 begin perform public.erp_save_verified_dyed_bill(edit_payload,proof);raise exception 'TEST stale edit';exception when serialization_failure then null;end;
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 update garments_erp.employee_status set is_active=false where employee_id=900001;
 perform set_config('request.jwt.claim.sub',actor::text,true);perform set_config('request.jwt.claims',claims::text,true);
 begin perform public.erp_dyed_bill_attestation(actor,900001,edit_payload);raise exception 'TEST inactive verifier';exception when insufficient_privilege then null;end;
 if has_function_privilege('authenticated','garments_erp.save_fabric_document_core(text,jsonb,text,jsonb,bigint)','execute') or has_function_privilege('anon','public.erp_save_verified_dyed_bill(jsonb,uuid)','execute') then raise exception 'TEST exposed privileged function';end if;
 raise notice 'PASS verified dyed-bill create/edit, fresh password, exact payload, single use, expiry, stale edits, atomic rollback and restricted core';
end $$;
rollback;
