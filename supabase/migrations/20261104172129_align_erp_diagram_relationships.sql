begin;

create table garments_erp.job_status_history (
  id bigint generated always as identity primary key,
  job_id bigint not null references garments_erp.job(id),
  item_status_list_id bigint references garments_erp.item_status_list(id),
  recorded_at timestamptz not null default clock_timestamp()
);

create table garments_erp.lab_dip_version_review (
  id bigint generated always as identity primary key,
  lab_dip_version_id bigint not null references garments_erp.lab_dip_version(id),
  lab_dip_status_id bigint references garments_erp.lab_dip_version_status(id),
  comments text,
  recorded_at timestamptz not null default clock_timestamp()
);

alter table garments_erp.job_status_history enable row level security;
alter table garments_erp.lab_dip_version_review enable row level security;
revoke all on garments_erp.job_status_history, garments_erp.lab_dip_version_review
  from public, anon, authenticated;

create index on garments_erp.job_status_history (job_id, id);
create index on garments_erp.lab_dip_version_review (lab_dip_version_id, id);

-- Capture future status changes in the same transaction as the parent write.
-- Existing rows do not supply reliable historical transition dates.
create function garments_access.record_job_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into garments_erp.job_status_history (job_id, item_status_list_id)
  values (new.id, new.item_status_list_id);
  return new;
end;
$$;
revoke all on function garments_access.record_job_status_change() from public, anon, authenticated;

create trigger record_job_status_change
after update on garments_erp.job
for each row when (old.item_status_list_id is distinct from new.item_status_list_id)
execute function garments_access.record_job_status_change();

create function garments_access.record_lab_dip_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into garments_erp.lab_dip_version_review
    (lab_dip_version_id, lab_dip_status_id, comments)
  values (new.id, new.lab_dip_status_id, new.comments);
  return new;
end;
$$;
revoke all on function garments_access.record_lab_dip_review() from public, anon, authenticated;

create trigger record_lab_dip_review
after update on garments_erp.lab_dip_version
for each row when (old.lab_dip_status_id is distinct from new.lab_dip_status_id)
execute function garments_access.record_lab_dip_review();

-- Retain the header link for existing callers and ambiguous historical receipts.
alter table garments_erp.raw_material_purchase_order_item
  add constraint raw_material_po_line_identity unique
  (id, raw_material_purchase_order_id, raw_material_item_id);

alter table garments_erp.raw_material_check_in
  add column raw_material_purchase_order_item_id bigint,
  add constraint raw_material_receipt_line_requires_purchase check (
    raw_material_purchase_order_item_id is null or (
      dyed_fabric_item_id is null and purchase_order_id is not null
      and raw_material_item_id is not null
    )
  ),
  add constraint raw_material_receipt_line_matches_purchase foreign key
  (raw_material_purchase_order_item_id, purchase_order_id, raw_material_item_id)
  references garments_erp.raw_material_purchase_order_item
  (id, raw_material_purchase_order_id, raw_material_item_id);

create index on garments_erp.raw_material_check_in (raw_material_purchase_order_item_id);

with matches as (
  select receipt.id, min(line.id) as line_id
  from garments_erp.raw_material_check_in receipt
  join garments_erp.raw_material_purchase_order_item line
    on line.raw_material_purchase_order_id = receipt.purchase_order_id
   and line.raw_material_item_id = receipt.raw_material_item_id
  where receipt.dyed_fabric_item_id is null
  group by receipt.id having count(*) = 1
)
update garments_erp.raw_material_check_in receipt
set raw_material_purchase_order_item_id = matches.line_id
from matches where receipt.id = matches.id;

create or replace function garments_access.fabric_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $body$
declare t text; rows jsonb; result jsonb:='{}'; fields text; keys text[]:=array(select jsonb_object_keys(garments_access.fabric_contract()));
begin
 if auth.uid() is null or not exists(select 1 from unnest(keys) k where garments_access.has_screen_permission(k,'view')) then raise exception 'Fabric access is not enabled' using errcode='42501';end if;
 for t in select distinct d.table_name from garments_access.app_db_table d join garments_access.app_resource_table rt on rt.app_db_table_id=d.id join garments_access.app_resource r on r.id=rt.app_resource_id where d.schema_name='garments_erp' and r.key=any(keys) and rt.can_view and garments_access.has_screen_permission(r.key,'view') and d.table_name=any(array['contacts','contact_purpose','brand_list','yarn_supplier','knitter','dyer','yarn_type','fabric_type','color_map','color_map_by_brand','lab_dip','lab_dip_version','lab_dip_version_status','fabric_status_list','yarn_purchase_order','yarn_purchase_order_item','yarn_bill','yarn_bill_item','knitting_bill','knitting_bill_item','dyeing_program','dyeing_program_item','dyed_fabric_bill','dyed_fabric_item','batch_no_lab_dip_version_map']) loop
  fields:=case when t='contacts' then 'jsonb_build_object(''id'',x.id::text,''company_name'',x.company_name,''updated_at'',x.updated_at)' else 'garments_access.fabric_json('||quote_literal(t)||',to_jsonb(x))' end;
  execute format('select coalesce(jsonb_agg(%s order by x.id),''[]''::jsonb) from garments_erp.%I x',fields,t) into rows;
  result:=jsonb_set(result,array[t],rows);
 end loop;
 -- Attachment metadata only for records already visible in this snapshot. Private paths stay private.
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'filename',a.filename,'mime_type',a.mime_type,'file_size',a.file_size)),'[]'::jsonb) into rows from garments_erp.attachments a where a.id::text in (
 select r->>'bill_attachment' from jsonb_array_elements(coalesce(result->'yarn_bill','[]')||coalesce(result->'knitting_bill','[]')||coalesce(result->'dyed_fabric_bill','[]')) r
 union select r->>'shade_card_image_attachment' from jsonb_array_elements(coalesce(result->'lab_dip_version','[]')) r);
 -- Review records inherit the Lab Dips screen permission and visible version set.
 if garments_access.has_screen_permission('labDips','view') and result ? 'lab_dip_version' then
  result:=result||jsonb_build_object('lab_dip_version_review', (
   select coalesce(jsonb_agg(jsonb_build_object(
    'id',review.id::text,'lab_dip_version_id',review.lab_dip_version_id::text,
    'lab_dip_status_id',review.lab_dip_status_id::text,'comments',review.comments,
    'recorded_at',review.recorded_at
   ) order by review.id desc),'[]'::jsonb)
   from garments_erp.lab_dip_version_review review
   where review.lab_dip_version_id in (
    select (v->>'id')::bigint from jsonb_array_elements(result->'lab_dip_version') v
   )
  ));
 end if;
 return result||jsonb_build_object('attachments',rows,'_live',true);
end $body$;

-- Require a failed latest attempt under the existing edition lock.
create or replace function garments_erp.guard_lab_dip_version() returns trigger language plpgsql security invoker set search_path='' as $$
declare parent_id bigint; max_version integer; closed boolean; swatch_order integer;
begin
 parent_id:=case when TG_OP='DELETE' then OLD.lab_dip_id else NEW.lab_dip_id end;
 perform 1 from garments_erp.lab_dip where id=parent_id for update;
 if not found then raise exception 'Lab dip does not exist';end if;
 if TG_OP='UPDATE' and (NEW.lab_dip_id<>OLD.lab_dip_id or NEW.version<>OLD.version) then raise exception 'A version cannot be moved or renumbered';end if;
 select exists(select 1 from garments_erp.lab_dip_version v join garments_erp.lab_dip_version_status s on s.id=v.lab_dip_status_id where v.lab_dip_id=parent_id and s.sort_order>=4) into closed;
 if closed then raise exception 'This edition is complete. Create a new edition for further attempts';end if;
 select max(version) into max_version from garments_erp.lab_dip_version where lab_dip_id=parent_id;
 if TG_OP='INSERT' and NEW.version<>coalesce(max_version,0)+1 then raise exception 'Versions must start at 1 and increase by one';end if;
 if TG_OP='INSERT' and max_version is not null and not exists (
  select 1 from garments_erp.lab_dip_version v
  join garments_erp.lab_dip_version_status s on s.id=v.lab_dip_status_id
  where v.lab_dip_id=parent_id and v.version=max_version and s.sort_order=3
 ) then raise exception 'The latest version must be Failed before adding another version';end if;
 if TG_OP='DELETE' then
  if OLD.version<>max_version then raise exception 'Only the latest unapproved version may be removed';end if;
  return OLD;
 end if;
 if TG_OP='UPDATE' and OLD.version<>max_version then raise exception 'Only the latest version may be updated';end if;
 select sort_order into swatch_order from garments_erp.lab_dip_version_status where id=NEW.lab_dip_status_id;
 if NEW.attached_swatch is distinct from (coalesce(swatch_order=4,false)) then raise exception 'Attached swatch flag must match Attached Swatch status';end if;
 return NEW;
end$$;

commit;
