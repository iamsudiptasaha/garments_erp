-- Synthetic populated migration fixtures in the isolated replay database only.
-- The shared seed knows the new route; remove it to model the pre-migration DB.
delete from garments_access.app_file_route where target_key='employeePhoto';
insert into garments_erp.attachments(id,bucket_group_id,storage_path,address,mime_type)
select 990001,id,'employee/900001/employee_photo/portrait','legacy-private-photo','image/png'
from garments_erp.bucket_group where "group"='employee';
insert into garments_erp.attachments(id,bucket_group_id,storage_path,mime_type)
select 990002,id,'item/990002/image_attachment/item','image/png'
from garments_erp.bucket_group where "group"='items';
update garments_erp.employee set employee_photo='legacy-private-photo' where id=900001;
update garments_erp.employee set employee_photo='https://unresolved.invalid/photo.jpg' where id=900002;
insert into garments_erp.employee(id,employee_code,contacts_id,contact_purpose_id,employee_photo)
values(990003,'SCE-PHOTO-ID',900001,900001,'990001'),
      (990004,'SCE-PHOTO-FOREIGN',900001,900001,'990002');
