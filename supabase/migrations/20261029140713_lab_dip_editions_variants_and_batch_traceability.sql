-- Approved scope: lab-dip editions/versions, variant selection, batch traceability.
-- Existing shade references are migrated with UNKNOWN approval, never invented approval.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table garments_erp.color_map_by_brand, garments_erp.dyeing_program_item,
 garments_erp.dyed_fabric_item, garments_erp.design, garments_erp.variant,
 garments_erp.variant_lab_dip in access exclusive mode;
do $$begin
 if exists(select 1 from garments_erp.variant) or exists(select 1 from garments_erp.variant_lab_dip) then raise exception 'Variant backfill requires review; migration expects empty legacy mappings';end if;
 if exists(select 1 from garments_erp.color_map_by_brand group by color_map_id,brand_list_id having count(*)>1) then raise exception 'Duplicate colour-brand mappings require review';end if;
 if exists(select 1 from garments_erp.color_map_by_brand where shade_card_image is not null) then raise exception 'Legacy image text requires explicit attachment migration';end if;
end$$;

alter table garments_erp.variant rename to variant_item;
alter table garments_erp.design rename to variant;
alter table garments_erp.variant rename column design_name to variant_name;
alter table garments_erp.variant_item rename column design_id to variant_id;
alter table garments_erp.variant_item drop constraint variant_item_part_design_color_key;
alter table garments_erp.variant_item drop column color_map_id;
alter table garments_erp.variant_item add constraint variant_item_part_variant_key unique(item_part_id,variant_id);
-- The diagram retains design_per_job/design_id and challan design_id names.
-- Their existing FKs follow the renamed variant relation automatically.
alter table garments_erp.lab_dip_status rename to lab_dip_version_status;
alter table garments_erp.lab_dip_version_status add column sort_order integer;
alter table garments_erp.lab_dip_version_status add constraint lab_dip_status_order_key unique(sort_order);
alter table garments_erp.lab_dip_version_status add constraint lab_dip_status_order_positive check(sort_order>0);
do $$begin
 if exists(select 1 from garments_erp.lab_dip_version_status) then raise exception 'Existing status definitions require review';end if;
end$$;
insert into garments_erp.lab_dip_version_status(status,sort_order) values
 ('At Dyer',1),('Awaiting buyer comments',2),('Failed',3),('Attached Swatch',4),('Approved with comments',5),('Approved',6);
alter table garments_erp.lab_dip_version_status alter column sort_order set not null;
alter table garments_erp.lab_dip_version_status add constraint lab_dip_status_name_key unique(status);

create table garments_erp.lab_dip(
 id bigint generated always as identity primary key,
 date date,
 edition integer not null check(edition>0),
 color_map_by_brand_id bigint not null references garments_erp.color_map_by_brand(id),
 dyer_id bigint not null references garments_erp.dyer(id),
 created_at timestamptz not null default now(),
 unique(color_map_by_brand_id,dyer_id,edition)
);
create index lab_dip_dyer_idx on garments_erp.lab_dip(dyer_id);
create table garments_erp.lab_dip_version(
 id bigint generated always as identity primary key,
 lab_dip_id bigint not null references garments_erp.lab_dip(id),
 version integer not null check(version>0),
 date date,
 shade_card_no text,
 shade_card_option text,
 comments text,
 shade_card_image_attachment bigint references garments_erp.attachments(id),
 lab_dip_status_id bigint references garments_erp.lab_dip_version_status(id),
 attached_swatch boolean not null default false,
 created_at timestamptz not null default now(),
 unique(lab_dip_id,version)
);
create index lab_dip_version_status_idx on garments_erp.lab_dip_version(lab_dip_status_id);
create index lab_dip_version_attachment_idx on garments_erp.lab_dip_version(shade_card_image_attachment);
-- One edition per legacy colour/dyer pair, including actual program dyers.
insert into garments_erp.lab_dip(date,edition,color_map_by_brand_id,dyer_id)
 select min(source_date),1,mapping,dyer from (
 select m.id mapping,m.dyer_id dyer,m.created_at::date source_date from garments_erp.color_map_by_brand m where m.dyer_id is not null
 union all
 select i.color_map_by_brand_id,p.dyer_id,p.date::date from garments_erp.dyeing_program_item i join garments_erp.dyeing_program p on p.id=i.dyeing_program_id
 ) s group by mapping,dyer;
insert into garments_erp.lab_dip_version(lab_dip_id,version,date,shade_card_no,shade_card_option,comments)
 select l.id,1,l.date,m.shade_card_no,m.shade_card_option,
 'Legacy shade reference migrated; approval status was not recorded.'
 from garments_erp.lab_dip l join garments_erp.color_map_by_brand m on m.id=l.color_map_by_brand_id;

alter table garments_erp.variant_item add column lab_dip_id bigint references garments_erp.lab_dip(id);
create index variant_item_lab_dip_idx on garments_erp.variant_item(lab_dip_id);
create index variant_item_variant_idx on garments_erp.variant_item(variant_id);

alter table garments_erp.dyeing_program_item add column lab_dip_version_id bigint references garments_erp.lab_dip_version(id);
update garments_erp.dyeing_program_item i set lab_dip_version_id=v.id
 from garments_erp.dyeing_program p,garments_erp.lab_dip l,garments_erp.lab_dip_version v
 where p.id=i.dyeing_program_id and l.color_map_by_brand_id=i.color_map_by_brand_id and l.dyer_id=p.dyer_id and l.edition=1 and v.lab_dip_id=l.id and v.version=1;
alter table garments_erp.dyeing_program_item alter column lab_dip_version_id set not null;
create index dyeing_program_item_lab_version_idx on garments_erp.dyeing_program_item(lab_dip_version_id);

create table garments_erp.batch_no_lab_dip_version_map(
 id bigint generated always as identity primary key,
 dyed_fabric_item_id bigint not null unique references garments_erp.dyed_fabric_item(id),
 batch_no text not null unique check(length(btrim(batch_no))>0 and batch_no=btrim(batch_no)),
 lab_dip_version_id bigint not null references garments_erp.lab_dip_version(id),
 created_at timestamptz not null default now()
);
create index batch_map_lab_version_idx on garments_erp.batch_no_lab_dip_version_map(lab_dip_version_id);
insert into garments_erp.batch_no_lab_dip_version_map(dyed_fabric_item_id,batch_no,lab_dip_version_id)
 select d.id,d.batch_no,i.lab_dip_version_id from garments_erp.dyed_fabric_item d join garments_erp.dyeing_program_item i on i.id=d.dyeing_program_item_id;
drop trigger trg_validate_dyeing_program_batch on garments_erp.dyeing_program_item;
drop function garments_erp.validate_dyeing_program_batch();
alter table garments_erp.dyeing_program_item drop constraint fk_dpi_previous_batch;
alter table garments_erp.dyeing_program_item add constraint fk_dpi_previous_batch foreign key(batch_no) references garments_erp.batch_no_lab_dip_version_map(batch_no);
alter table garments_erp.dyed_fabric_item drop column batch_no;
alter table garments_erp.dyeing_program_item drop column color_map_by_brand_id;
alter table garments_erp.color_map_by_brand drop constraint uq_color_map_brand_dyer;
alter table garments_erp.color_map_by_brand drop column dyer_id,drop column shade_card_no,drop column shade_card_option,drop column shade_card_image;
alter table garments_erp.color_map_by_brand add constraint color_map_brand_key unique(color_map_id,brand_list_id);

-- Retain the obsolete empty manual-status table as an explicitly retired archive.
-- This avoids deleting data/structure unexpectedly; it is not used by the new view.
alter table garments_erp.variant_lab_dip rename to variant_lab_dip_legacy;
comment on table garments_erp.variant_lab_dip_legacy is 'Retired manual status mapping. Use variant_item.lab_dip_id and view_variant_item_lab_dip_status.';

-- Serialise edition lifecycle through the parent row. Approval is terminal.
create function garments_erp.guard_lab_dip_version() returns trigger language plpgsql security invoker set search_path='' as $$
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
 if TG_OP='DELETE' then
  if OLD.version<>max_version then raise exception 'Only the latest unapproved version may be removed';end if;
  return OLD;
 end if;
 if TG_OP='UPDATE' and OLD.version<>max_version then raise exception 'Only the latest version may be updated';end if;
 select sort_order into swatch_order from garments_erp.lab_dip_version_status where id=NEW.lab_dip_status_id;
 if NEW.attached_swatch is distinct from (coalesce(swatch_order=4,false)) then raise exception 'Attached swatch flag must match Attached Swatch status';end if;
 return NEW;
end$$;
create trigger guard_lab_dip_version before insert or update or delete on garments_erp.lab_dip_version for each row execute function garments_erp.guard_lab_dip_version();

create function garments_erp.guard_lab_dip_identity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (NEW.edition,NEW.color_map_by_brand_id,NEW.dyer_id) is distinct from (OLD.edition,OLD.color_map_by_brand_id,OLD.dyer_id)
 and exists(select 1 from garments_erp.lab_dip_version where lab_dip_id=OLD.id) then raise exception 'An edition with versions cannot be moved or renumbered';end if;
 return NEW;
end$$;
create trigger guard_lab_dip_identity before update on garments_erp.lab_dip for each row execute function garments_erp.guard_lab_dip_identity();

-- Check all paths to the same batch/version at transaction end, allowing
-- a bill line and its mandatory mapping to be created together.
create function garments_erp.check_lab_dip_traceability() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from garments_erp.dyed_fabric_item d left join garments_erp.batch_no_lab_dip_version_map b on b.dyed_fabric_item_id=d.id where b.id is null) then raise exception 'Every dyed-fabric item requires one batch mapping';end if;
 if exists(select 1 from garments_erp.batch_no_lab_dip_version_map b join garments_erp.dyed_fabric_item d on d.id=b.dyed_fabric_item_id join garments_erp.dyeing_program_item i on i.id=d.dyeing_program_item_id where i.lab_dip_version_id<>b.lab_dip_version_id) then raise exception 'Batch and originating program must reference the same lab-dip version';end if;
 if exists(select 1 from garments_erp.dyeing_program_item i join garments_erp.dyeing_program p on p.id=i.dyeing_program_id join garments_erp.lab_dip_version v on v.id=i.lab_dip_version_id join garments_erp.lab_dip l on l.id=v.lab_dip_id where p.dyer_id is distinct from l.dyer_id) then raise exception 'Lab-dip dyer must match the program dyer';end if;
 if exists(select 1 from garments_erp.dyeing_program_item i join garments_erp.batch_no_lab_dip_version_map b on b.batch_no=i.batch_no where i.lab_dip_version_id<>b.lab_dip_version_id) then raise exception 'Previous batch must use the selected lab-dip version';end if;
 if exists(select 1 from garments_erp.dyeing_program_item i join garments_erp.batch_no_lab_dip_version_map b on b.batch_no=i.batch_no join garments_erp.dyed_fabric_item d on d.id=b.dyed_fabric_item_id where d.dyeing_program_item_id=i.id) then raise exception 'A program cannot use its own output as a previous batch';end if;
 if exists(select 1 from garments_erp.variant_item vi join garments_erp.item_part ip on ip.id=vi.item_part_id join garments_erp.item it on it.id=ip.item_id join garments_erp.lab_dip l on l.id=vi.lab_dip_id join garments_erp.color_map_by_brand cm on cm.id=l.color_map_by_brand_id where it.brand_id is distinct from cm.brand_list_id) then raise exception 'Selected lab dip must match the item brand';end if;
 return null;
end$$;
do $$declare tab text;begin
 foreach tab in array array['dyed_fabric_item','batch_no_lab_dip_version_map','dyeing_program_item','dyeing_program','variant_item','item','item_part','lab_dip','lab_dip_version','color_map_by_brand'] loop
 execute format('create constraint trigger check_lab_dip_traceability after insert or update or delete on garments_erp.%I deferrable initially deferred for each row execute function garments_erp.check_lab_dip_traceability()',tab);
 end loop;
end$$;

create view garments_erp.view_variant_item_lab_dip_status with(security_invoker=true) as
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
 left join garments_erp.lab_dip_version_status s on s.id=v.lab_dip_status_id;
create view garments_erp.view_default_lab_dip_version with(security_invoker=true) as
 select distinct on(l.color_map_by_brand_id,l.dyer_id) l.color_map_by_brand_id,l.dyer_id,l.id as lab_dip_id,l.edition,v.id as lab_dip_version_id,v.version,v.date,s.status
 from garments_erp.lab_dip l join garments_erp.lab_dip_version v on v.lab_dip_id=l.id
 join garments_erp.lab_dip_version_status s on s.id=v.lab_dip_status_id
 where s.sort_order>=4
 order by l.color_map_by_brand_id,l.dyer_id,v.date desc nulls last,l.edition desc,v.version desc,v.id desc;

-- No new client access: the live business permission rollout is separate.
do $$declare tab text;begin
 foreach tab in array array['lab_dip','lab_dip_version','batch_no_lab_dip_version_map','lab_dip_version_status','variant','variant_item','variant_lab_dip_legacy'] loop
 execute format('alter table garments_erp.%I enable row level security',tab);
 execute format('revoke all on garments_erp.%I from public,anon,authenticated',tab);
 end loop;
end$$;
revoke all on garments_erp.view_variant_item_lab_dip_status,garments_erp.view_default_lab_dip_version from public,anon,authenticated;
revoke all on function garments_erp.guard_lab_dip_version(),garments_erp.guard_lab_dip_identity(),garments_erp.check_lab_dip_traceability() from public,anon,authenticated;
-- Keep screen-table registry identities and role mappings through renames.
update garments_access.app_db_table set table_name='variant_item' where schema_name='garments_erp' and table_name='variant';
update garments_access.app_db_table set table_name='variant' where schema_name='garments_erp' and table_name='design';
commit;
