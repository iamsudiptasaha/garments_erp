-- Synthetic, rollback-only fixtures. Run against the isolated test database.
begin;
do $$
declare c bigint; other_contact bigint; a bigint; b bigint; bank bigint;
begin
 insert into garments_erp.contacts(company_name) values ('Synthetic primary probe') returning id into c;
 insert into garments_erp.contacts(company_name) values ('Synthetic other probe') returning id into other_contact;
 insert into garments_erp.contact_items(contact_id, address,primary_address) values(c,'Synthetic A',true) returning id into a;
 insert into garments_erp.contact_items(contact_id, phone,primary_phone) values(c,'0000',true) returning id into b;
 if exists(select 1 from garments_erp.contact_items where id=a and primary_phone is distinct from false) then raise exception 'Primary default is not false';end if;
 begin
  insert into garments_erp.contact_items(contact_id,primary_address) values(c,true);
  raise exception 'Duplicate primary address accepted';
 exception when unique_violation then null;end;
 begin
  update garments_erp.contact_items set primary_phone=true where id=a;
  raise exception 'Duplicate primary phone accepted';
 exception when unique_violation then null;end;
 -- Different contacts can each have a primary; zero is also permitted.
 insert into garments_erp.contact_items(contact_id,primary_address,primary_phone) values(other_contact,true,true);
 update garments_erp.contact_items set primary_address=false where id=a;
 update garments_erp.contact_items set primary_address=true where id=b;
 if not exists(select 1 from garments_erp.contact_items where id=b and primary_address and primary_phone) then raise exception 'Primary transfer failed';end if;
 insert into garments_erp.contact_bank_account(contact_id,primary_bank_account) values(c,true) returning id into bank;
 insert into garments_erp.contact_bank_account(contact_id) values(c);
 begin
  insert into garments_erp.contact_bank_account(contact_id,primary_bank_account) values(c,true);
  raise exception 'Duplicate primary bank accepted';
 exception when unique_violation then null;end;
 begin
  update garments_erp.contact_bank_account set primary_bank_account=null where id=bank;
  raise exception 'Nullable primary bank accepted';
 exception when not_null_violation then null;end;
 update garments_erp.contact_bank_account set primary_bank_account=false where id=bank;
end $$;
rollback;
