-- Run on the isolated Supabase replay with database/ci/seed.mjs fixtures.
begin;
insert into garments_access.app_role_resource_permission(app_role_id, app_resource_id, can_view)
select role.id, resource.id, true from garments_access.app_role role, garments_access.app_resource resource
where role.key='ci_viewer' and resource.key='materialContacts';

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000001"}',true);

do $$
declare
 snapshot jsonb;
 contact jsonb;
 item jsonb;
 detail jsonb;
 bank jsonb;
 attachment bigint;
 request uuid := gen_random_uuid();
 ticket jsonb;
begin
 snapshot := public.erp_save_contact_workspace('{
   "header":{"company_name":"Synthetic contact integration"},
   "sections":{
     "contact_items":[{"name":"Dispatch","phone":"0012","primary_phone":true,"email":"dispatch@example.test","primary_email":true}],
     "contact_extra":[{"key":"Website","value":"example.invalid"}],
     "contact_bank_account":[{"name":"Synthetic bank","account_number":"000012"}]
   }
 }');
 select value into strict contact from jsonb_array_elements(snapshot->'contacts')
   where value->>'company_name'='Synthetic contact integration';
 select value into strict item from jsonb_array_elements(snapshot->'contact_items')
   where value->>'contact_id'=contact->>'id';
 select value into strict detail from jsonb_array_elements(snapshot->'contact_extra')
   where value->>'contact_id'=contact->>'id';
 select value into strict bank from jsonb_array_elements(snapshot->'contact_bank_account')
   where value->>'contact_id'=contact->>'id';
 if item->>'phone'<>'0012' or item->>'email' is distinct from 'dispatch@example.test'
    or not coalesce((item->>'primary_email')::boolean,false) or bank->>'account_number'<>'000012' then
   raise exception 'Identifiers stored as text lost their leading zeros';
 end if;

 snapshot := public.erp_save_contact_workspace(jsonb_build_object(
   'header',contact||'{"search_term":"Updated contact"}',
   'sections',jsonb_build_object(
     'contact_bank_account',jsonb_build_array(bank||'{"branch":"Updated branch","primary_bank_account":true}'),
     'contact_items',jsonb_build_array(
     item||'{"primary_phone":false,"email":"dispatch-updated@example.test","primary_email":false}',
     '{"name":"Orders","phone":"0034","primary_phone":true,"email":"orders@example.test","primary_email":true}'::jsonb))));
 if not exists(select 1 from jsonb_array_elements(snapshot->'contact_items') where value->>'phone'='0034'
   and (value->>'primary_phone')::boolean and (value->>'primary_email')::boolean
   and value->>'email'='orders@example.test' and value->>'contact_id'=contact->>'id') then
   raise exception 'Nested primary change did not persist';
 end if;
 if not exists(select 1 from jsonb_array_elements(snapshot->'contact_items')
   where value->>'id'=item->>'id' and value->>'email'='dispatch-updated@example.test') then
   raise exception 'Existing contact item email change did not persist';
 end if;
 select value into strict bank from jsonb_array_elements(public.erp_contacts_workspace()->'contact_bank_account')
   where value->>'id'=bank->>'id' and value->>'contact_id'=contact->>'id';
 if bank->>'branch' is distinct from 'Updated branch'
    or bank->>'account_number' is distinct from '000012'
    or (bank->>'primary_bank_account')::boolean is distinct from true then
   raise exception 'Existing bank account changes did not persist';
 end if;
 begin
   perform public.erp_save_contact_workspace(jsonb_build_object('header',contact||'{"search_term":"Stale"}'));
   raise exception 'Stale edit accepted';
 exception when serialization_failure then null; end;
 select value into strict contact from jsonb_array_elements(snapshot->'contacts') where value->>'id'=contact->>'id';

 begin
   perform public.erp_save_contact_workspace(jsonb_build_object(
     'header',contact||'{"search_term":"Must roll back"}',
     'sections','{"contact_extra":[{"key":" website ","value":"duplicate"}]}'::jsonb));
   raise exception 'Duplicate detail accepted';
 exception when raise_exception then
   if sqlerrm<>'This detail already exists for this contact' then raise;end if;
 end;
 snapshot := public.erp_contacts_workspace();
 if exists(select 1 from jsonb_array_elements(snapshot->'contacts') where value->>'search_term'='Must roll back') then
   raise exception 'Contact update survived failed nested save';
 end if;

 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 perform set_config('request.jwt.claims','{"aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000002"}',true);
 snapshot := public.erp_contacts_workspace();
 if snapshot->'contacts'='[]' or snapshot->'contact_bank_account'<>'[]'
   or snapshot->'contact_extra'<>'[]' or snapshot->'contact_items'<>'[]' then
   raise exception 'Contact child permissions not isolated';
 end if;
 begin
   perform public.erp_save_contact_workspace(jsonb_build_object('header',contact));
   raise exception 'Read-only account edited contact';
 exception when insufficient_privilege then null; end;

 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims','{"aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000001"}',true);
 ticket := public.erp_stage_file_upload(request,'contactBankDocument',(bank->>'id')::bigint,null,
   'proof.pdf','application/pdf',10,repeat('a',64));
 if ticket->>'storage_path' is null or ticket->>'bucket_id' is null then raise exception 'Bank file route did not reserve a private object';end if;
 perform set_config('contacts_test.request',request::text,true);
 perform set_config('contacts_test.ticket',ticket::text,true);
 perform set_config('contacts_test.contact',contact::text,true);
 perform set_config('contacts_test.bank',bank::text,true);
end $$;

-- Storage API writes this row after upload. Simulate only its object metadata
-- here so the database integration can verify finalization and scoped reads.
reset role;
insert into storage.objects(bucket_id,name,metadata)
select t->>'bucket_id',t->>'storage_path','{"size":10,"mimetype":"application/pdf"}'::jsonb
from (select current_setting('contacts_test.ticket')::jsonb t) ticket;
set local role authenticated;

do $$
declare
 snapshot jsonb;
 contact jsonb := current_setting('contacts_test.contact')::jsonb;
 bank jsonb := current_setting('contacts_test.bank')::jsonb;
 attachment jsonb;
begin
 attachment := public.erp_finish_file_upload(current_setting('contacts_test.request')::uuid);
 if not exists(select 1 from jsonb_array_elements(public.erp_file_list('contactBankDocument',(bank->>'id')::bigint))
    where value->>'id'=attachment->>'id') then
   raise exception 'Saved supporting document cannot be retrieved';
 end if;
 perform public.erp_remove_file_link('contactBankDocument',(bank->>'id')::bigint,(attachment->>'id')::bigint);
 snapshot := public.erp_contacts_workspace();
 select value into strict bank from jsonb_array_elements(snapshot->'contact_bank_account') where value->>'id'=bank->>'id';
 if bank->>'supporting_documents' is not null then raise exception 'Attachment link was not removed'; end if;
 snapshot := public.erp_save_contact_workspace(jsonb_build_object(
   'header',contact||'{"remove":true}',
   'sections',jsonb_build_object(
     'contact_bank_account',jsonb_build_array(bank||'{"remove":true}'),
     'contact_items',(select jsonb_agg(value||'{"remove":true}') from jsonb_array_elements(snapshot->'contact_items') where value->>'contact_id'=contact->>'id'),
     'contact_extra',(select jsonb_agg(value||'{"remove":true}') from jsonb_array_elements(snapshot->'contact_extra') where value->>'contact_id'=contact->>'id')
   )));
 if exists(select 1 from jsonb_array_elements(snapshot->'contacts') where value->>'id'=contact->>'id') then
   raise exception 'Contact deletion did not persist';
 end if;
end $$;
rollback;
