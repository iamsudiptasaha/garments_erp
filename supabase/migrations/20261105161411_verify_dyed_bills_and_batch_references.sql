-- Local preparation only. Release through the reviewed GitHub Actions workflow.
begin;

-- The batch FK already targets mapping IDs. No business FK is recreated here.
-- Only eligible active employees with linked enabled portal accounts can verify.
create function garments_access.dyed_bill_user_allowed(p_user uuid,p_action text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from garments_access.app_user u join garments_erp.employee e on e.id=u.employee_id
 join auth.users a on a.id=u.user_id
 join garments_access.app_user_role ur on ur.user_id=u.user_id
 join garments_access.app_role role on role.id=ur.role_id and role.is_active
 join garments_access.app_resource r on r.key='dyeBills' and garments_access.resource_available(r.id)
 left join garments_access.app_role_resource_permission p on p.app_role_id=role.id and p.app_resource_id=r.id
 where u.user_id=p_user and u.is_active and e.is_active and e.is_verified and not u.must_change_password
 and a.deleted_at is null and (a.banned_until is null or a.banned_until<=now())
 and p_action in ('create','edit') and (not r.admin_only or role.is_system_admin)
 and (role.is_system_admin or (p.can_view and case when p_action='create' then p.can_create else p.can_edit end)));
$$;

create function garments_access.dyed_bill_verifiers() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not garments_access.has_screen_permission('dyeBills','create') and not garments_access.has_screen_permission('dyeBills','edit') then return '[]'::jsonb;end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,
 'label',coalesce(c.company_name,e.employee_code)||' · '||e.employee_code,'email',a.email,
 'create',garments_access.dyed_bill_user_allowed(u.user_id,'create'),
 'edit',garments_access.dyed_bill_user_allowed(u.user_id,'edit')) order by e.employee_code),'[]'::jsonb)
 from garments_access.app_user u join garments_erp.employee e on e.id=u.employee_id
 join auth.users a on a.id=u.user_id left join garments_erp.contacts c on c.id=e.contacts_id
 where a.email is not null and (garments_access.dyed_bill_user_allowed(u.user_id,'create') or garments_access.dyed_bill_user_allowed(u.user_id,'edit')));
end $$;
create function public.erp_dyed_bill_verifiers() returns jsonb
language sql security invoker set search_path='' as $$select garments_access.dyed_bill_verifiers()$$;

create table garments_access.dyed_bill_attestation (
 id uuid primary key default gen_random_uuid(),
 actor uuid not null references auth.users(id),
 verifier uuid not null references auth.users(id),
 verifier_session uuid not null references auth.sessions(id) on delete cascade,
 employee_id bigint not null references garments_erp.employee(id),
 payload_hash text not null,
 expires_at timestamptz not null default now()+interval '90 seconds',
 used_at timestamptz
);
alter table garments_access.dyed_bill_attestation enable row level security;
revoke all on garments_access.dyed_bill_attestation from public,anon,authenticated;
create index on garments_access.dyed_bill_attestation(expires_at);

create function garments_access.attest_dyed_bill(p_actor uuid,p_employee bigint,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare token uuid; operation text:=p_payload->>'action';
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>1000000
 or p_payload->>'resource' is distinct from 'dyeBills' or operation is null or operation not in ('create','edit')
 or p_payload->'root'->>'table' is distinct from 'dyed_fabric_bill' then raise exception 'Invalid dyed bill command';end if;
 if not garments_access.dyed_bill_user_allowed(auth.uid(),operation)
 or not garments_access.dyed_bill_user_allowed(p_actor,operation)
 or not exists(select 1 from garments_access.app_user where user_id=auth.uid() and employee_id=p_employee)
 or not exists(select 1 from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' and (not_after is null or not_after>now()))
 or not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) a
 where a->>'method'='password' and (a->>'timestamp')::numeric between extract(epoch from now())-90 and extract(epoch from now())+5)
 then raise exception 'An eligible selected employee must confirm their password' using errcode='42501';end if;
 insert into garments_access.dyed_bill_attestation(actor,verifier,verifier_session,employee_id,payload_hash)
 values(p_actor,auth.uid(),(auth.jwt()->>'session_id')::uuid,p_employee,encode(extensions.digest(p_payload::text,'sha256'),'hex')) returning id into token;
 return token;
end $$;
create function public.erp_dyed_bill_attestation(p_actor uuid,p_employee bigint,p_payload jsonb) returns uuid
language sql security invoker set search_path='' as $$select garments_access.attest_dyed_bill(p_actor,p_employee,p_payload)$$;

create or replace function garments_access.save_fabric_document_core(p_resource text, p_root jsonb, p_action text, p_changes jsonb, p_verifier bigint) returns jsonb
language plpgsql security definer set search_path='' as $body$
declare contract jsonb:=garments_access.fabric_contract(); root_table text:=p_root->>'table'; root_id text:=p_root->>'id'; original_root text:=p_root->>'id'; change jsonb; t text; rid text; vals jsonb; oldrow jsonb; actual jsonb; fields jsonb; col text; columns_sql text; select_sql text; assignments text; created_id text; mapped jsonb:='{}'; entry record; delete_pass boolean; root_expected jsonb:=p_root->'before'; root_actual jsonb; permitted_roots text[]; changed_dyed text[]; changed_program text[]; review jsonb; review_job bigint; review_changed boolean;
begin
 if p_action not in ('create','edit') or not (contract ? p_resource) or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>500 or jsonb_array_length(p_changes)=0 then raise exception 'Invalid Fabric command';end if;
 if not garments_access.has_screen_permission(p_resource,p_action) then raise exception 'This account cannot save this record' using errcode='42501';end if;
 permitted_roots:=case p_resource when 'suppliers' then array['yarn_supplier','knitter','dyer'] when 'labDips' then array['lab_dip'] when 'orders' then array['yarn_purchase_order'] when 'yarn' then array['yarn_bill'] when 'knitting' then array['knitting_bill'] when 'programs' then array['dyeing_program'] when 'dyeBills' then array['dyed_fabric_bill'] else array(select jsonb_object_keys(contract->p_resource)) end;
 if not root_table=any(permitted_roots) or root_id is null then raise exception 'Invalid document scope';end if;
 -- All portal Fabric writers serialize; source-balance checks and multi-row writes are atomic.
 perform pg_catalog.pg_advisory_xact_lock(741208531);
 if p_action='edit' then
  if root_id!~'^[0-9]+$' then raise exception 'Invalid record identity';end if;
  execute format('select to_jsonb(x) from garments_erp.%I x where id=$1::bigint for update',root_table) into root_actual using root_id;
  if root_actual is null or garments_access.fabric_json(root_table,root_actual) is distinct from root_expected then raise exception 'This document changed. Reload and review it again.' using errcode='40001';end if;
 elsif root_id!~'^[0-9a-f-]{36}$' then raise exception 'New records require a temporary identity';end if;
 if exists(select 1 from jsonb_array_elements(p_changes) c where jsonb_typeof(c)<>'object' or not (c ?& array['table','id','before','values']) or c->>'id' is null or c->>'table' is null) then raise exception 'Malformed document change';end if;
 -- Updates/inserts in client contract dependency order. Deletes run in reverse afterwards.
 foreach delete_pass in array array[false,true] loop
 for change in select value from jsonb_array_elements(p_changes) with ordinality c(value,n) where (value->'values'='null'::jsonb)=delete_pass order by case when delete_pass then -n else n end loop
  t:=change->>'table';rid:=change->>'id';oldrow:=change->'before';vals:=change->'values';fields:=contract->p_resource->t;
  if fields is null then raise exception 'Table is outside this screen';end if;
  if vals<>'null'::jsonb then
   if jsonb_typeof(vals)<>'object' or exists(select 1 from jsonb_object_keys(vals) k where not fields ? k) then raise exception 'Field is outside the writable contract';end if;
   for entry in select key,value from jsonb_each_text(vals) loop
    if mapped ? entry.value then vals:=jsonb_set(vals,array[entry.key],mapped->entry.value);end if;
   end loop;
   for entry in select e.key,e.value from jsonb_each_text(vals) e join information_schema.columns c on c.table_schema='garments_erp' and c.table_name=t and c.column_name=e.key where c.data_type in ('numeric','integer') and e.value is not null loop if entry.value::numeric<0 then raise exception 'Quantities, weights and rates cannot be negative';end if;end loop;
   if t='lab_dip_version' and coalesce((vals->>'attached_swatch')::boolean,false) then vals:=vals||jsonb_build_object('shade_card_no',null,'shade_card_option',null,'lab_dip_status_id',(select id::text from garments_erp.lab_dip_version_status where sort_order=4));end if;
  end if;
  review:=null;review_changed:=false;
  if t='lab_dip_version' and not delete_pass then
   review:=jsonb_build_object('date',vals->'date','comments',vals->'comments','lab_dip_status_id',vals->'lab_dip_status_id');
   review_changed:=oldrow='null'::jsonb or row(oldrow->'date',oldrow->'comments',oldrow->'lab_dip_status_id')
     is distinct from row(review->'date',review->'comments',review->'lab_dip_status_id');
   vals:=vals-array['date','comments','lab_dip_status_id'];
  end if;
  if oldrow<>'null'::jsonb then
   if rid!~'^[0-9]+$' then raise exception 'Invalid existing identity';end if;
   execute format('select to_jsonb(x) from garments_erp.%I x where id=$1::bigint for update',t) into actual using rid;
   if actual is null or garments_access.fabric_json(t,actual) is distinct from oldrow then raise exception 'A linked record changed. Reload and review again.' using errcode='40001';end if;
   if not garments_access.fabric_row_in_document(t,actual,root_table,root_id) then raise exception 'Record belongs to another document';end if;
   if t='contacts' then raise exception 'Edit existing shared company details from Contacts';end if;
   if delete_pass then
    if t=root_table or t=any(array['contacts','lab_dip','lab_dip_version']) then raise exception 'This record cannot be removed here';end if;
    execute format('delete from garments_erp.%I where id=$1::bigint',t) using rid;
   else
    if not garments_access.fabric_row_in_document(t,vals||jsonb_build_object('id',rid),root_table,root_id) then raise exception 'Cannot move a row between documents';end if;
    select string_agg(format('%I=v.%I',key,key),',') into assignments from jsonb_object_keys(vals) key;
    execute format('update garments_erp.%I x set %s from jsonb_populate_record(null::garments_erp.%I,$1) v where x.id=$2::bigint',t,assignments,t) using vals,rid;
   end if;
  else
   if mapped ? rid then raise exception 'Duplicate temporary identity';end if;
   if delete_pass or rid!~'^[0-9a-f-]{36}$' then raise exception 'Invalid new record';end if;
   if not garments_access.fabric_row_in_document(t,vals||jsonb_build_object('id',rid),root_table,case when t=root_table then original_root else root_id end) then raise exception 'New row is outside the document';end if;
   select string_agg(format('%I',key),','),string_agg(format('v.%I',key),',') into columns_sql,select_sql from jsonb_object_keys(vals) key;
   execute format('insert into garments_erp.%I (%s) select %s from jsonb_populate_record(null::garments_erp.%I,$1) v returning id::text',t,columns_sql,select_sql,t) into created_id using vals;
   mapped:=mapped||jsonb_build_object(rid,created_id);if t=root_table then root_id:=created_id;end if;
  end if;
  if review_changed then
   review_job:=coalesce(mapped->>rid,rid)::bigint;
   insert into garments_erp.lab_dip_version_item(lab_dip_version_id,date,comments,lab_dip_status_id)
   values(review_job,(review->>'date')::date,review->>'comments',(review->>'lab_dip_status_id')::bigint);
  end if;
 end loop;
 end loop;
 if p_action='create' and not (mapped ? original_root) then raise exception 'The new document header is missing';end if;
 if p_resource='suppliers' then
  for change in select value from jsonb_array_elements(p_changes) where value->>'table'='contacts' loop
   if not exists(select 1 from jsonb_array_elements(p_changes) r where r->>'table'=root_table and r->'values'->>'contacts_id'=change->>'id') then raise exception 'New company must be assigned to this supplier';end if;
  end loop;
 end if;
 execute format('update garments_erp.%I set updated_at=clock_timestamp() where id=$1::bigint',root_table) using root_id;
 if root_table=any(array['yarn_purchase_order','yarn_bill','knitting_bill','dyeing_program','dyed_fabric_bill','lab_dip']) then
  t:=case root_table when 'yarn_purchase_order' then 'yarn_purchase_order_item' when 'yarn_bill' then 'yarn_bill_item' when 'knitting_bill' then 'knitting_bill_item' when 'dyeing_program' then 'dyeing_program_item' when 'dyed_fabric_bill' then 'dyed_fabric_item' else 'lab_dip_version' end;
  col:=case root_table when 'yarn_purchase_order' then 'purchase_order_number_id' else root_table||'_id' end;
  execute format('select to_jsonb(count(*)) from garments_erp.%I where %I=$1::bigint',t,col) into actual using root_id;
  if actual='0'::jsonb then raise exception 'A document must contain at least one line or version';end if;
 end if;
 -- Weight gain and shortage are allowed. Only source identity/type compatibility is checked.
 select coalesce(array_agg(distinct ref) filter(where ref is not null),array[]::text[]) into changed_dyed from (select coalesce(mapped->>(c->>'id'),c->>'id') ref from jsonb_array_elements(p_changes) c where c->>'table'='dyed_fabric_item' and c->'values'<>'null'::jsonb and exists(select 1 from unnest(array['billed_quantity','gross_quantity','final_quantity','knitting_bill_item_id','dyeing_program_item_id']) f where c->'before'->f is distinct from c->'values'->f)) q;
 select coalesce(array_agg(distinct ref) filter(where ref is not null),array[]::text[]) into changed_program from (select coalesce(mapped->>(c->>'id'),c->>'id') ref from jsonb_array_elements(p_changes) c where c->>'table'='dyeing_program_item' and c->'values'<>'null'::jsonb and exists(select 1 from unnest(array['fabric_type_id']) f where c->'before'->f is distinct from c->'values'->f)) q;
 if exists(select 1 from garments_erp.dyed_fabric_item d join garments_erp.dyeing_program_item p on p.id=d.dyeing_program_item_id join garments_erp.knitting_bill_item k on k.id=d.knitting_bill_item_id where (d.id::text=any(changed_dyed) or p.id::text=any(changed_program)) and p.fabric_type_id<>k.fabric_type_id) then raise exception 'The changed dyeing program fabric type does not match its knitted source.';end if;
 set constraints all immediate;
 insert into garments_access.app_activity_log(actor_user_id,app_resource_id,action,target_type,target_id,details)
 values(auth.uid(),(select id from garments_access.app_resource where key=p_resource),'Saved '||p_action||' document',root_table,root_id,jsonb_build_object('screen',p_resource,'changed_rows',jsonb_array_length(p_changes)));
 if p_resource='dyeBills' then
  if p_verifier is null then raise exception 'Dyed bill password verification required' using errcode='42501';end if;
  update garments_erp.dyed_fabric_bill set verified_by_employee_id=p_verifier where id=root_id::bigint;
 end if;
 return garments_access.fabric_snapshot();
end $body$;

-- Preserve the existing public API for other Fabric documents. Its old dyed-bill
-- path is closed; callers cannot bypass verification by using the generic RPC.
create or replace function garments_access.save_fabric_document(p_resource text,p_root jsonb,p_action text,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_resource='dyeBills' then raise exception 'Dyed bill password verification required' using errcode='42501';end if;
 return garments_access.save_fabric_document_core(p_resource,p_root,p_action,p_changes,null);
end $$;

create function garments_access.save_verified_dyed_bill(p_payload jsonb,p_proof uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare proof garments_access.dyed_bill_attestation; operation text:=p_payload->>'action'; result jsonb;
begin
 if p_payload->>'resource' is distinct from 'dyeBills' or operation is null or operation not in ('create','edit')
 or p_payload->'root'->>'table' is distinct from 'dyed_fabric_bill'
 or not garments_access.has_screen_permission('dyeBills',operation) then raise exception 'Dyed bill access required' using errcode='42501';end if;
 select * into proof from garments_access.dyed_bill_attestation where id=p_proof for update;
 if not found or proof.actor<>auth.uid() or proof.expires_at<=now() or proof.used_at is not null
 or proof.payload_hash<>encode(extensions.digest(p_payload::text,'sha256'),'hex')
 or not garments_access.dyed_bill_user_allowed(proof.verifier,operation)
 or not exists(select 1 from garments_access.app_user where user_id=proof.verifier and employee_id=proof.employee_id)
 or not exists(select 1 from auth.sessions where id=proof.verifier_session and user_id=proof.verifier and (not_after is null or not_after>now()))
 then raise exception 'Employee verification expired or changed. Verify this bill again.' using errcode='42501';end if;
 result:=garments_access.save_fabric_document_core('dyeBills',p_payload->'root',operation,p_payload->'changes',proof.employee_id);
 update garments_access.dyed_bill_attestation set used_at=now() where id=p_proof;
 return result;
end $$;
create function public.erp_save_verified_dyed_bill(p_payload jsonb,p_proof uuid) returns jsonb
language sql security invoker set search_path='' as $$select garments_access.save_verified_dyed_bill(p_payload,p_proof)$$;

revoke all on function garments_access.save_fabric_document_core(text,jsonb,text,jsonb,bigint) from public,anon,authenticated;
revoke all on function garments_access.dyed_bill_user_allowed(uuid,text) from public,anon,authenticated;
revoke all on function garments_access.dyed_bill_verifiers(),public.erp_dyed_bill_verifiers(),
 garments_access.attest_dyed_bill(uuid,bigint,jsonb),public.erp_dyed_bill_attestation(uuid,bigint,jsonb),
 garments_access.save_verified_dyed_bill(jsonb,uuid),public.erp_save_verified_dyed_bill(jsonb,uuid) from public,anon;
grant execute on function garments_access.dyed_bill_verifiers(),public.erp_dyed_bill_verifiers(),
 garments_access.attest_dyed_bill(uuid,bigint,jsonb),public.erp_dyed_bill_attestation(uuid,bigint,jsonb),
 garments_access.save_verified_dyed_bill(jsonb,uuid),public.erp_save_verified_dyed_bill(jsonb,uuid) to authenticated;
commit;
