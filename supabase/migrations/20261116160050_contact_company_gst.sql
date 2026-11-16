begin;

alter table garments_erp.contacts add column is_company boolean not null default false;

-- The two GST-bearing production records were reviewed and approved as companies.
-- Preserve their GST text verbatim and let the constraint reject unreviewed rows.
update garments_erp.contacts set is_company = true
where id in (2, 3) and gst is not null;

alter table garments_erp.contacts add constraint contacts_gst_requires_company
check (is_company or gst is null);

create function garments_erp.clear_non_company_contact_gst() returns trigger
language plpgsql set search_path='' as $$
begin
 new.gst := null;
 return new;
end;
$$;

create trigger clear_non_company_contact_gst
before insert or update on garments_erp.contacts
for each row when (not new.is_company and new.gst is not null)
execute function garments_erp.clear_non_company_contact_gst();

create or replace function garments_erp.save_contact_workspace(p_document jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 root jsonb := p_document->'header';
 changes jsonb := coalesce(p_document->'sections','{}');
 cid bigint := (root->>'id')::bigint;
 original_stamp timestamptz;
 action text;
 entry jsonb;
 child_id bigint;
 removing boolean;
 saved_bank_ids jsonb := '{}'::jsonb;
begin
 if jsonb_typeof(root) is distinct from 'object' or jsonb_typeof(changes) <> 'object'
   or exists(select 1 from jsonb_object_keys(changes) as k where k not in ('contact_items','contact_extra','contact_bank_account')) then
   raise exception 'Invalid contact document';
 end if;
 action := case when coalesce((root->>'remove')::boolean,false) then 'delete'
                when cid is null then 'create' else 'edit' end;
 if not garments_access.has_screen_permission('materialContacts','view')
    or not garments_access.has_screen_permission('materialContacts',action) then
   raise exception 'Contact permission required' using errcode='42501';
 end if;
 if action <> 'delete' and nullif(btrim(root->>'company_name'),'') is null then
   raise exception 'Enter a company / contact name';
 end if;
 if cid is null then
   if action <> 'create' then raise exception 'Select a saved contact'; end if;
   insert into garments_erp.contacts(company_name,gst,search_term,is_company)
   values(btrim(root->>'company_name'),nullif(root->>'gst',''),nullif(root->>'search_term',''),coalesce((root->>'is_company')::boolean,false))
   returning id into cid;
 else
   select updated_at into original_stamp from garments_erp.contacts where id=cid for update;
   if not found or original_stamp is distinct from (root->>'updated_at')::timestamptz then
     raise exception 'Contact changed. Reload and review again.' using errcode='40001';
   end if;
   if action='edit' then
     update garments_erp.contacts set company_name=btrim(root->>'company_name'),
       gst=case when root ? 'gst' then nullif(root->>'gst','') else gst end,
       search_term=nullif(root->>'search_term',''),
       is_company=coalesce((root->>'is_company')::boolean,is_company) where id=cid;
   end if;
 end if;

 if changes ? 'contact_items' then
   -- Validate ownership, permissions and revisions before touching primary flags.
   for entry in select value from jsonb_array_elements(changes->'contact_items') loop
     child_id := (entry->>'id')::bigint;
     removing := coalesce((entry->>'remove')::boolean,false);
     if (action='delete' and not removing) or (removing and child_id is null) then
       raise exception 'Invalid contact child action';
     end if;
     if not garments_access.has_screen_permission('contactPeople',
         case when removing then 'delete' when child_id is null then 'create' else 'edit' end) then
       raise exception 'Contact section permission required' using errcode='42501';
     end if;
     if child_id is not null then
       select updated_at into original_stamp from garments_erp.contact_items
       where id=child_id and contact_id=cid for update;
       if not found or original_stamp is distinct from (entry->>'updated_at')::timestamptz then
         raise exception 'Contact entry changed. Reload and review again.' using errcode='40001';
       end if;
     end if;
   end loop;
   update garments_erp.contact_items set primary_address=false, primary_phone=false, primary_email=false
   where contact_id=cid and id in (
     select (value->>'id')::bigint from jsonb_array_elements(changes->'contact_items')
     where not coalesce((value->>'remove')::boolean,false)
   ) and (primary_address or primary_phone or primary_email);
   for entry in select value from jsonb_array_elements(changes->'contact_items')
     order by not coalesce((value->>'remove')::boolean,false) loop
     child_id := (entry->>'id')::bigint;
     if coalesce((entry->>'remove')::boolean,false) then
       delete from garments_erp.contact_items where id=child_id and contact_id=cid;
     elsif child_id is null then
       insert into garments_erp.contact_items(contact_id,name,phone,address,email,primary_address,primary_phone,primary_email)
       values(cid,nullif(entry->>'name',''),nullif(entry->>'phone',''),nullif(entry->>'address',''),nullif(entry->>'email',''),coalesce((entry->>'primary_address')::boolean,false),coalesce((entry->>'primary_phone')::boolean,false),coalesce((entry->>'primary_email')::boolean,false));
     else
       update garments_erp.contact_items set
         name=nullif(entry->>'name',''),
         phone=nullif(entry->>'phone',''),
         address=nullif(entry->>'address',''),
         email=nullif(entry->>'email',''),
         primary_address=coalesce((entry->>'primary_address')::boolean,false),
         primary_phone=coalesce((entry->>'primary_phone')::boolean,false),
         primary_email=coalesce((entry->>'primary_email')::boolean,false)
       where id=child_id and contact_id=cid;
     end if;
   end loop;
 end if;

 if changes ? 'contact_extra' then
   -- Validate ownership, permissions and revisions before touching primary flags.
   for entry in select value from jsonb_array_elements(changes->'contact_extra') loop
     child_id := (entry->>'id')::bigint;
     removing := coalesce((entry->>'remove')::boolean,false);
     if (action='delete' and not removing) or (removing and child_id is null) then
       raise exception 'Invalid contact child action';
     end if;
     if not garments_access.has_screen_permission('contactDetails',
         case when removing then 'delete' when child_id is null then 'create' else 'edit' end) then
       raise exception 'Contact section permission required' using errcode='42501';
     end if;
     if child_id is not null then
       select updated_at into original_stamp from garments_erp.contact_extra
       where id=child_id and contact_id=cid for update;
       if not found or original_stamp is distinct from (entry->>'updated_at')::timestamptz then
         raise exception 'Contact entry changed. Reload and review again.' using errcode='40001';
       end if;
     end if;
     if not removing and nullif(btrim(entry->>'key'),'') is null then
       raise exception 'Enter a detail name';
     end if;
   end loop;
   for entry in select value from jsonb_array_elements(changes->'contact_extra')
     order by not coalesce((value->>'remove')::boolean,false) loop
     child_id := (entry->>'id')::bigint;
     if coalesce((entry->>'remove')::boolean,false) then
       delete from garments_erp.contact_extra where id=child_id and contact_id=cid;
     elsif child_id is null then
       insert into garments_erp.contact_extra(contact_id,key,value)
       values(cid,btrim(entry->>'key'),nullif(entry->>'value',''));
     else
       update garments_erp.contact_extra set
         key=btrim(entry->>'key'),
         value=nullif(entry->>'value','')
       where id=child_id and contact_id=cid;
     end if;
   end loop;
   if exists(select 1 from garments_erp.contact_extra where contact_id=cid
      group by lower(btrim(key)) having count(*) > 1) then
     raise exception 'This detail already exists for this contact';
   end if;
 end if;

 if changes ? 'contact_bank_account' then
   -- Validate ownership, permissions and revisions before touching primary flags.
   for entry in select value from jsonb_array_elements(changes->'contact_bank_account') loop
     child_id := (entry->>'id')::bigint;
     removing := coalesce((entry->>'remove')::boolean,false);
     if (action='delete' and not removing) or (removing and child_id is null) then
       raise exception 'Invalid contact child action';
     end if;
     if not garments_access.has_screen_permission('contactBankAccounts',
         case when removing then 'delete' when child_id is null then 'create' else 'edit' end) then
       raise exception 'Contact section permission required' using errcode='42501';
     end if;
     if child_id is not null then
       select updated_at into original_stamp from garments_erp.contact_bank_account
       where id=child_id and contact_id=cid for update;
       if not found or original_stamp is distinct from (entry->>'updated_at')::timestamptz then
         raise exception 'Contact entry changed. Reload and review again.' using errcode='40001';
       end if;
     end if;
     if removing and exists (select 1 from garments_erp.contact_bank_account where id=child_id
       and supporting_documents is not null) then
       raise exception 'Remove the supporting document through Files before deleting the bank account';
     end if;
   end loop;
   update garments_erp.contact_bank_account set primary_bank_account=false
   where contact_id=cid and id in (
     select (value->>'id')::bigint from jsonb_array_elements(changes->'contact_bank_account')
     where not coalesce((value->>'remove')::boolean,false)
   ) and (primary_bank_account);
   for entry in select value from jsonb_array_elements(changes->'contact_bank_account')
     order by not coalesce((value->>'remove')::boolean,false) loop
     child_id := (entry->>'id')::bigint;
     if coalesce((entry->>'remove')::boolean,false) then
       delete from garments_erp.contact_bank_account where id=child_id and contact_id=cid;
     elsif child_id is null then
       insert into garments_erp.contact_bank_account(contact_id,account_holder_name,name,account_number,branch,ifsc_code,bank_account_type_id,address,primary_bank_account)
       values(cid,nullif(entry->>'account_holder_name',''),nullif(entry->>'name',''),nullif(entry->>'account_number',''),nullif(entry->>'branch',''),nullif(entry->>'ifsc_code',''),nullif(entry->>'bank_account_type_id','')::bigint,nullif(entry->>'address',''),coalesce((entry->>'primary_bank_account')::boolean,false)) returning id into child_id;
       if entry ? 'client_ref' then
         saved_bank_ids := saved_bank_ids || jsonb_build_object((entry->>'client_ref')::uuid::text,child_id::text);
       end if;
     else
       update garments_erp.contact_bank_account set
         account_holder_name=nullif(entry->>'account_holder_name',''),
         name=nullif(entry->>'name',''),
         account_number=nullif(entry->>'account_number',''),
         branch=nullif(entry->>'branch',''),
         ifsc_code=nullif(entry->>'ifsc_code',''),
         bank_account_type_id=nullif(entry->>'bank_account_type_id','')::bigint,
         address=nullif(entry->>'address',''),
         primary_bank_account=coalesce((entry->>'primary_bank_account')::boolean,false)
       where id=child_id and contact_id=cid;
     end if;
   end loop;
   if exists(select 1 from garments_erp.contact_bank_account where contact_id=cid
      and nullif(replace(account_number,' ',''),'') is not null
      group by replace(account_number,' ','') having count(*) > 1) then
     raise exception 'This account number already exists for this contact';
   end if;
 end if;

 if action='delete' then
   if exists(select 1 from garments_erp.contact_items where contact_id=cid)
      or exists(select 1 from garments_erp.contact_extra where contact_id=cid)
      or exists(select 1 from garments_erp.contact_bank_account where contact_id=cid) then
     raise exception 'This contact still has linked records and cannot be deleted' using errcode='23503';
   end if;
   delete from garments_erp.contacts where id=cid;
 end if;
 return garments_erp.contacts_workspace() || jsonb_build_object('savedBankIds',saved_bank_ids);
exception when foreign_key_violation then
 if action='delete' then
   raise exception 'This contact still has linked records and cannot be deleted' using errcode='23503';
 end if;
 raise;
end;
$$;
commit;
