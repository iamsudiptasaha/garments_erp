-- Disposable synthetic database only; all business fixtures roll back.
begin;
do $$
declare yarn bigint; supplier bigint; po bigint; poi bigint; ybi bigint; fabric bigint; knit bigint;
 brand bigint; colour bigint; mapping bigint; dyer bigint; lab bigint; version bigint; program bigint; program_item bigint;
 payload jsonb; edit_payload jsonb; invalid_payload jsonb; proof uuid; result jsonb; root jsonb; saved_id bigint;
 actor uuid:='00000000-0000-4000-8000-000000000001'; claims jsonb;
 header_temp text:=gen_random_uuid()::text; line_temp text:=gen_random_uuid()::text; batch_temp text:=gen_random_uuid()::text;
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
 claims:=jsonb_build_object('sub',actor,'aal','aal2','session_id','10000000-0000-4000-8000-000000000001','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now()))));
 perform set_config('request.jwt.claim.sub',actor::text,true);perform set_config('request.jwt.claims',claims::text,true);
 payload:=jsonb_build_object('resource','dyeBills','action','create','root',jsonb_build_object('table','dyed_fabric_bill','id',header_temp,'before',null),'changes',jsonb_build_array(
 jsonb_build_object('table','dyed_fabric_bill','id',header_temp,'before',null,'values',jsonb_build_object('invoice_number','VERIFY-CREATE','invoice_date',current_date)),
 jsonb_build_object('table','dyed_fabric_item','id',line_temp,'before',null,'values',jsonb_build_object('dyed_fabric_bill_id',header_temp,'dyeing_program_item_id',program_item::text,'knitting_bill_item_id',knit::text,'gross_quantity',10,'billed_quantity',9,'final_quantity',9,'dyeing_rate',10,'dyeing_rolls',1)),
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
 proof:=public.erp_dyed_bill_attestation(actor,900001,edit_payload);
 begin perform public.erp_save_verified_dyed_bill(edit_payload,proof);raise exception 'TEST stale edit';exception when serialization_failure then null;end;
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 update garments_erp.employee set is_active=false where id=900001;
 perform set_config('request.jwt.claim.sub',actor::text,true);perform set_config('request.jwt.claims',claims::text,true);
 begin perform public.erp_dyed_bill_attestation(actor,900001,edit_payload);raise exception 'TEST inactive verifier';exception when insufficient_privilege then null;end;
 if has_function_privilege('authenticated','garments_erp.save_fabric_document_core(text,jsonb,text,jsonb,bigint)','execute') or has_function_privilege('anon','public.erp_save_verified_dyed_bill(jsonb,uuid)','execute') then raise exception 'TEST exposed privileged function';end if;
 raise notice 'PASS verified dyed-bill create/edit, fresh password, exact payload, single use, expiry, stale edits, atomic rollback and restricted core';
end $$;
rollback;
