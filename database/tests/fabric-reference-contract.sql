-- Read-only contract verification for the synced UI. No schema/data changes.
do $$ declare t text;
begin
 foreach t in array array['brand_list','yarn_supplier','knitter','dyer'] loop
  if (select count(*) from information_schema.columns where table_schema='garments_erp' and table_name=t and column_name in ('contacts_id','contact_purpose_id') and is_nullable='NO')<>2 then raise exception 'Required contact links differ for %',t;end if;
 end loop;
 if not exists(select 1 from information_schema.columns where table_schema='garments_erp' and table_name='dyeing_program_item' and column_name='lab_dip_version_id' and is_nullable='NO') then raise exception 'Program version FK is missing';end if;
 if exists(select 1 from information_schema.columns where table_schema='garments_erp' and ((table_name='dyed_fabric_item' and column_name='batch_no') or (table_name='dyeing_program_item' and column_name='color_map_by_brand_id'))) then raise exception 'Obsolete persistence field still exists';end if;
 if (select count(*) from pg_constraint where conrelid='garments_erp.batch_no_lab_dip_version_map'::regclass and contype='u' and pg_get_constraintdef(oid) in ('UNIQUE (batch_no)','UNIQUE (dyed_fabric_item_id)'))<>2 then raise exception 'Batch uniqueness contract changed';end if;
 if exists(select 1 from garments_erp.batch_no_lab_dip_version_map b join garments_erp.dyed_fabric_item d on d.id=b.dyed_fabric_item_id join garments_erp.dyeing_program_item p on p.id=d.dyeing_program_item_id where b.lab_dip_version_id<>p.lab_dip_version_id) then raise exception 'Existing batch data disagrees with its program version';end if;
end $$;
