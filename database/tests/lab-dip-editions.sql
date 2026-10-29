-- Rollback-only verification. No fixture business records survive.
begin;
do $$
declare mapping_id bigint; dyer_key bigint; edition_key bigint; first_version bigint; accepted_version bigint;
 failed_status bigint; approved_status bigint; item_key bigint; part_key bigint; part_type bigint; variant_key bigint; variant_item_key bigint; existing_version bigint; actual text; caught boolean;
begin
 select color_map_by_brand_id,dyer_id into mapping_id,dyer_key from garments_erp.lab_dip order by id limit 1;
 select id into failed_status from garments_erp.lab_dip_version_status where sort_order=3;
 select id into approved_status from garments_erp.lab_dip_version_status where sort_order=6;
 insert into garments_erp.lab_dip(edition,color_map_by_brand_id,dyer_id,date) select coalesce(max(edition),0)+1,mapping_id,dyer_key,current_date from garments_erp.lab_dip where color_map_by_brand_id=mapping_id and dyer_id=dyer_key returning id into edition_key;
 caught:=false;begin insert into garments_erp.lab_dip_version(lab_dip_id,version) values(edition_key,2);exception when raise_exception then caught:=true;end;
 if not caught then raise exception 'TEST: version 2 allowed before version 1';end if;
 insert into garments_erp.lab_dip_version(lab_dip_id,version,lab_dip_status_id) values(edition_key,1,failed_status) returning id into first_version;
 insert into garments_erp.item(style_code,brand_id) select 'ROLLBACK-ONLY-LAB-TEST',brand_list_id from garments_erp.color_map_by_brand where id=mapping_id returning id into item_key;
 insert into garments_erp.part_list(part) values('Rollback-only part '||gen_random_uuid()::text) returning id into part_type;
 insert into garments_erp.item_part(item_id,part_list_id) values(item_key,part_type) returning id into part_key;
 insert into garments_erp.variant(variant_name) values('Rollback-only variant') returning id into variant_key;
 insert into garments_erp.variant_item(item_part_id,variant_id) values(part_key,variant_key) returning id into variant_item_key;
 select lab_dip_status into actual from garments_erp.view_variant_item_lab_dip_status where variant_item_id=variant_item_key;
 if actual<>'Lab dip not selected' then raise exception 'TEST: missing selection status incorrect';end if;
 update garments_erp.variant_item set lab_dip_id=edition_key where id=variant_item_key;
 select lab_dip_status into actual from garments_erp.view_variant_item_lab_dip_status where variant_item_id=variant_item_key;
 if actual<>'Failed' then raise exception 'TEST: version 1 status incorrect';end if;
 insert into garments_erp.lab_dip_version(lab_dip_id,version,lab_dip_status_id) values(edition_key,2,failed_status) returning id into accepted_version;
 select lab_dip_status into actual from garments_erp.view_variant_item_lab_dip_status where variant_item_id=variant_item_key;
 if actual<>'Redo 2 · Failed' then raise exception 'TEST: redo status incorrect';end if;
 update garments_erp.lab_dip_version set lab_dip_status_id=approved_status,date=current_date where id=accepted_version;
 select lab_dip_status into actual from garments_erp.view_variant_item_lab_dip_status where variant_item_id=variant_item_key;
 if actual<>'Approved' then raise exception 'TEST: approved status incorrect';end if;
 if not exists(select 1 from garments_erp.view_default_lab_dip_version where lab_dip_version_id=accepted_version) then raise exception 'TEST: default approved version missing';end if;
 caught:=false;begin insert into garments_erp.lab_dip_version(lab_dip_id,version) values(edition_key,3);exception when raise_exception then caught:=true;end;
 if not caught then raise exception 'TEST: accepted edition allowed further version';end if;
 caught:=false;begin update garments_erp.lab_dip_version set comments='overwrite approved' where id=accepted_version;exception when raise_exception then caught:=true;end;
 if not caught then raise exception 'TEST: accepted edition mutable';end if;
 caught:=false;begin update garments_erp.lab_dip set edition=edition+1000 where id=edition_key;exception when raise_exception then caught:=true;end;
 if not caught then raise exception 'TEST: edition identity mutable';end if;
 caught:=false;begin insert into garments_erp.batch_no_lab_dip_version_map(dyed_fabric_item_id,batch_no,lab_dip_version_id) select dyed_fabric_item_id,batch_no,accepted_version from garments_erp.batch_no_lab_dip_version_map limit 1;exception when unique_violation then caught:=true;end;
 if not caught then raise exception 'TEST: duplicate batch mapping accepted';end if;
 select lab_dip_version_id into existing_version from garments_erp.dyeing_program_item order by id limit 1;
 caught:=false;begin
 update garments_erp.batch_no_lab_dip_version_map set lab_dip_version_id=accepted_version where id=(select min(id) from garments_erp.batch_no_lab_dip_version_map);
 set constraints all immediate;
 exception when raise_exception then caught:=true;end;
 if not caught then raise exception 'TEST: batch/program version mismatch accepted';end if;
 set constraints all immediate;
 raise notice 'Lab-dip lifecycle, defaults, variant status, batch uniqueness and version consistency checks passed';
end$$;
set constraints all deferred;
do $$declare source_row garments_erp.dyed_fabric_item; new_item bigint; second_item bigint; reference_version bigint; batch text; caught boolean; mapping bigint; dyer_key bigint; edition_key bigint; status_key bigint; ord integer;begin
 select * into source_row from garments_erp.dyed_fabric_item order by id limit 1;
 select lab_dip_version_id into reference_version from garments_erp.dyeing_program_item where id=source_row.dyeing_program_item_id;
 batch:='ROLLBACK-'||gen_random_uuid()::text;
 insert into garments_erp.dyed_fabric_item(dyed_fabric_bill_id,dyeing_program_item_id,knitting_bill_item_id) values(source_row.dyed_fabric_bill_id,source_row.dyeing_program_item_id,source_row.knitting_bill_item_id) returning id into new_item;
 insert into garments_erp.batch_no_lab_dip_version_map(dyed_fabric_item_id,batch_no,lab_dip_version_id) values(new_item,batch,reference_version);
 -- Same version reused by multiple distinct batches must work.
 insert into garments_erp.dyed_fabric_item(dyed_fabric_bill_id,dyeing_program_item_id,knitting_bill_item_id) values(source_row.dyed_fabric_bill_id,source_row.dyeing_program_item_id,source_row.knitting_bill_item_id) returning id into second_item;
 caught:=false;begin insert into garments_erp.batch_no_lab_dip_version_map(dyed_fabric_item_id,batch_no,lab_dip_version_id) values(second_item,batch,reference_version);exception when unique_violation then caught:=true;end;
 if not caught then raise exception 'TEST: batch number reused on another item';end if;
 insert into garments_erp.batch_no_lab_dip_version_map(dyed_fabric_item_id,batch_no,lab_dip_version_id) values(second_item,batch||'-SECOND',reference_version);
 set constraints all immediate;
 select color_map_by_brand_id,dyer_id into mapping,dyer_key from garments_erp.lab_dip order by id limit 1;
 foreach ord in array array[4,5] loop
 select id into status_key from garments_erp.lab_dip_version_status where sort_order=ord;
 insert into garments_erp.lab_dip(edition,color_map_by_brand_id,dyer_id) select coalesce(max(edition),0)+1,mapping,dyer_key from garments_erp.lab_dip where color_map_by_brand_id=mapping and dyer_id=dyer_key returning id into edition_key;
 insert into garments_erp.lab_dip_version(lab_dip_id,version,lab_dip_status_id,attached_swatch) values(edition_key,1,status_key,ord=4);
 caught:=false;begin insert into garments_erp.lab_dip_version(lab_dip_id,version) values(edition_key,2);exception when raise_exception then caught:=true;end;
 if not caught then raise exception 'TEST: accepted status % did not close edition',ord;end if;
 end loop;
end$$;
rollback;
