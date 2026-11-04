begin;

alter table garments_erp.lab_dip_version_review rename to lab_dip_version_item;
alter table garments_erp.lab_dip_version_item
  add column date date,
  add column latest boolean not null default false;

create unique index lab_dip_version_item_one_latest
  on garments_erp.lab_dip_version_item (lab_dip_version_id) where latest;

-- Older review rows have a recording timestamp but no captured business date.
-- Preserve them and seed the current dated state from each existing version.
insert into garments_erp.lab_dip_version_item
  (lab_dip_version_id, lab_dip_status_id, date, comments, latest)
select id, lab_dip_status_id, date, comments, true
from garments_erp.lab_dip_version;

-- The existing RPC still accepts version fields. Its guarded write acquires
-- the edition lock before this trigger appends the status item in the same transaction.
create or replace function garments_access.record_lab_dip_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if row(old.lab_dip_status_id, old.date, old.comments)
       is not distinct from row(new.lab_dip_status_id, new.date, new.comments) then
      return new;
    end if;
  end if;

  update garments_erp.lab_dip_version_item set latest = false
  where lab_dip_version_id = new.id and latest;

  insert into garments_erp.lab_dip_version_item
    (lab_dip_version_id, lab_dip_status_id, date, comments, latest)
  values (new.id, new.lab_dip_status_id, new.date, new.comments, true);
  return new;
end;
$$;

drop trigger record_lab_dip_review on garments_erp.lab_dip_version;
create trigger record_lab_dip_review
after insert or update on garments_erp.lab_dip_version
for each row execute function garments_access.record_lab_dip_review();

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
  result:=result||jsonb_build_object('lab_dip_version_item', (
   select coalesce(jsonb_agg(jsonb_build_object(
    'id',review.id::text,'lab_dip_version_id',review.lab_dip_version_id::text,
    'lab_dip_status_id',review.lab_dip_status_id::text,'comments',review.comments,
    'recorded_at',review.recorded_at,'date',review.date,'latest',review.latest
   ) order by review.id desc),'[]'::jsonb)
   from garments_erp.lab_dip_version_item review
   where review.lab_dip_version_id in (
    select (v->>'id')::bigint from jsonb_array_elements(result->'lab_dip_version') v
   )
  ));
 end if;
 return result||jsonb_build_object('attachments',rows,'_live',true);
end $body$;

create or replace function garments_erp.guard_lab_dip_version() returns trigger language plpgsql security invoker set search_path='' as $$
declare parent_id bigint; max_version integer; closed boolean; swatch_order integer;
begin
 parent_id:=case when TG_OP='DELETE' then OLD.lab_dip_id else NEW.lab_dip_id end;
 perform 1 from garments_erp.lab_dip where id=parent_id for update;
 if not found then raise exception 'Lab dip does not exist';end if;
 if TG_OP='UPDATE' and (NEW.lab_dip_id<>OLD.lab_dip_id or NEW.version<>OLD.version) then raise exception 'A version cannot be moved or renumbered';end if;
 select exists(select 1 from garments_erp.lab_dip_version v join garments_erp.lab_dip_version_item i on i.lab_dip_version_id=v.id and i.latest
  join garments_erp.lab_dip_version_status s on s.id=i.lab_dip_status_id where v.lab_dip_id=parent_id and s.sort_order>=4) into closed;
 if closed then raise exception 'This edition is complete. Create a new edition for further attempts';end if;
 select max(version) into max_version from garments_erp.lab_dip_version where lab_dip_id=parent_id;
 if TG_OP='INSERT' and NEW.version<>coalesce(max_version,0)+1 then raise exception 'Versions must start at 1 and increase by one';end if;
 if TG_OP='INSERT' and max_version is not null and not exists (
  select 1 from garments_erp.lab_dip_version v
  join garments_erp.lab_dip_version_item i on i.lab_dip_version_id=v.id and i.latest
  join garments_erp.lab_dip_version_status s on s.id=i.lab_dip_status_id
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

create or replace view garments_erp.view_variant_item_lab_dip_status with(security_invoker=true) as
 select vi.id,vi.id as variant_item_id,pc.id as production_checklist_id,vi.lab_dip_id,
 l.edition,v.id as lab_dip_version_id,v.version,s.status as version_status,
 case when vi.lab_dip_id is null then 'Lab dip not selected'
 when v.id is null then 'No versions yet'
 when s.id is null then 'Status not recorded'
 when v.version>1 and s.sort_order<=3 then 'Redo '||v.version::text||' · '||s.status
 else s.status end as lab_dip_status
 from garments_erp.variant_item vi
 join garments_erp.item_part ip on ip.id=vi.item_part_id
 left join garments_erp.production_checklist pc on pc.item_id=ip.item_id
 left join garments_erp.lab_dip l on l.id=vi.lab_dip_id
 left join lateral(select vv.* from garments_erp.lab_dip_version vv where vv.lab_dip_id=l.id order by vv.version desc limit 1)v on true
 left join garments_erp.lab_dip_version_item i on i.lab_dip_version_id=v.id and i.latest
 left join garments_erp.lab_dip_version_status s on s.id=i.lab_dip_status_id;
create or replace view garments_erp.view_default_lab_dip_version with(security_invoker=true) as
 select distinct on(l.color_map_by_brand_id,l.dyer_id) l.color_map_by_brand_id,l.dyer_id,l.id as lab_dip_id,l.edition,v.id as lab_dip_version_id,v.version,i.date,s.status
 from garments_erp.lab_dip l join garments_erp.lab_dip_version v on v.lab_dip_id=l.id
 join garments_erp.lab_dip_version_item i on i.lab_dip_version_id=v.id and i.latest
 join garments_erp.lab_dip_version_status s on s.id=i.lab_dip_status_id
 where s.sort_order>=4
 order by l.color_map_by_brand_id,l.dyer_id,i.date desc nulls last,l.edition desc,v.version desc,v.id desc;

commit;
