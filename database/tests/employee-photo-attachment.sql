begin;
do $$
begin
 if (select employee_photo from garments_erp.employee where id=900001) is distinct from 990001::bigint
 or (select employee_photo from garments_erp.employee where id=990003) is distinct from 990001::bigint
 or exists(select 1 from garments_erp.employee where id in(900002,990004) and employee_photo is not null)
 then raise exception 'Photo conversion lost a resolvable private image or retained an unsafe reference';end if;
 if not exists(select 1 from garments_erp.attachments where id=990002)
 then raise exception 'Photo conversion must not delete attachment objects';end if;
 if exists(select 1 from information_schema.columns where table_schema='garments_erp' and table_name='production_checklist' and column_name='tna_acquired_status_id')
 or (select count(*) from information_schema.columns where table_schema='garments_erp' and table_name='production_checklist' and column_name in('techpack_aqcuired_status_id','ordersheet_acquired_status_id'))<>2
 then raise exception 'Checklist does not match the reviewed ER';end if;
 if garments_access.file_target_definition('employeePhoto')->>'slot'<>'employee_photo'
 or not exists(select 1 from garments_access.app_file_route where target_key='employeePhoto' and allowed_mime_types=array['image/jpeg','image/png','image/webp'])
 then raise exception 'Private employee photo route is missing or allows documents';end if;
 begin
  update garments_erp.employee set employee_photo=9223372036854775807 where id=900001;
  raise exception 'TEST: missing attachment accepted';
 exception when foreign_key_violation then null;end;
 delete from garments_erp.attachments where id=990001;
 if exists(select 1 from garments_erp.employee where id in(900001,990003) and employee_photo is not null)
 then raise exception 'Deleting attachment must clear employee references';end if;
end $$;
rollback;
