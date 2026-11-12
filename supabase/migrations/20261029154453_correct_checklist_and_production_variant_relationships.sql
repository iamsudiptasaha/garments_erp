begin;
set local lock_timeout='5s';
do $$begin
 if exists(select 1 from garments_erp.job where verify_employee_id is null) then raise exception 'Unverified existing jobs need an explicit verifier';end if;
 if exists(select 1 from garments_erp.production_checklist where fpt_gpt_status_id is not null or photoshoot_sample_status_id is not null or shipment_sample_status_id is not null or tna_acquired_status_id is not null) then raise exception 'Existing checklist status values need semantic mapping, not ID reuse';end if;
 if exists(select 1 from garments_erp.design_per_job) or exists(select 1 from garments_erp.challan_job_item_pieces) or exists(select 1 from garments_erp.stage_pieces) then raise exception 'Existing variant production rows need explicit backfill';end if;
end$$;
alter table garments_erp.job alter column verify_employee_id set not null;
do $$declare field text;begin
 foreach field in array array['fpt_gpt_status_id','photoshoot_sample_status_id','shipment_sample_status_id','tna_acquired_status_id'] loop
 execute format('alter table garments_erp.production_checklist drop constraint %I','production_checklist_'||field||'_fkey');
 execute format('alter table garments_erp.production_checklist add constraint %I foreign key(%I) references garments_erp.item_status_list(id)','production_checklist_'||field||'_fkey',field);
 end loop;
end$$;
alter table garments_erp.design_per_job rename to variant_item_per_job;
alter table garments_erp.variant_item_per_job drop constraint design_per_job_design_id_fkey;
alter table garments_erp.variant_item_per_job rename column design_id to variant_item_id;
alter table garments_erp.variant_item_per_job add constraint variant_item_per_job_variant_item_id_fkey foreign key(variant_item_id) references garments_erp.variant_item(id);
alter table garments_erp.variant_item_per_job rename constraint design_per_job_job_id_design_id_key to variant_item_per_job_job_variant_key;
alter table garments_erp.stage_pieces rename column design_per_job_id to variant_item_per_job_id;
alter table garments_erp.stage_pieces rename column pieces_received to pieces_stock_out;
alter table garments_erp.stage_pieces alter column pieces_stock_out set default 0;
alter table garments_erp.stage_pieces add column pieces_stock_in numeric not null default 0;
alter table garments_erp.stage_pieces add constraint stage_piece_counts_valid check(pieces_stock_in>=0 and pieces_stock_in<'Infinity'::numeric and pieces_stock_in=trunc(pieces_stock_in) and pieces_stock_out>=0 and pieces_stock_out<'Infinity'::numeric and pieces_stock_out=trunc(pieces_stock_out));
alter table garments_erp.stage_pieces rename constraint stage_pieces_design_per_job_id_item_size_list_id_key to stage_pieces_variant_job_size_key;
alter table garments_erp.challan_job_item_pieces drop constraint challan_job_item_pieces_design_id_fkey;
alter table garments_erp.challan_job_item_pieces rename column design_id to variant_item_id;
alter table garments_erp.challan_job_item_pieces add constraint challan_pieces_variant_item_id_fkey foreign key(variant_item_id) references garments_erp.variant_item(id);
alter table garments_erp.stage add column pp_stage boolean not null default false;
alter table garments_erp.stage add constraint pp_stage_has_no_pieces check(not(pp_stage and track_pieces));
alter table garments_erp.variant alter column share_weight set default 1;
update garments_erp.variant set share_weight=1 where share_weight is null;
alter table garments_erp.variant alter column share_weight set not null;
alter table garments_erp.variant add constraint variant_share_weight_positive check(share_weight>0 and share_weight<'Infinity'::numeric);
create table garments_erp.job_assignees(
 id bigint generated always as identity primary key,
 job_id bigint not null references garments_erp.job(id),
 assigned_employees_id bigint not null references garments_erp.employee(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz default now(),
 unique(job_id,assigned_employees_id)
);
create index job_assignees_employee_idx on garments_erp.job_assignees(assigned_employees_id);
create trigger zz_stamp_updated_at before insert or update on garments_erp.job_assignees for each row execute function garments_access.stamp_updated_at();
alter table garments_erp.job_assignees enable row level security;
revoke all on garments_erp.job_assignees from public,anon,authenticated;

create function garments_erp.check_production_variant_links() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from garments_erp.variant_item_per_job link join garments_erp.job j on j.id=link.job_id join garments_erp.variant_item vi on vi.id=link.variant_item_id where j.item_part_id<>vi.item_part_id) then raise exception 'Job variants must belong to the job item part';end if;
 if exists(select 1 from garments_erp.stage_pieces p join garments_erp.variant_item_per_job link on link.id=p.variant_item_per_job_id join garments_erp.variant_item vi on vi.id=link.variant_item_id join garments_erp.item_part ip on ip.id=vi.item_part_id join garments_erp.item_size_list sz on sz.id=p.item_size_list_id where ip.item_id<>sz.item_id) then raise exception 'Stage size must belong to the job item';end if;
 if exists(select 1 from garments_erp.stage_pieces p join garments_erp.variant_item_per_job link on link.id=p.variant_item_per_job_id join garments_erp.job j on j.id=link.job_id join garments_erp.stage s on s.id=j.stage_id where s.pp_stage or not s.track_pieces) then raise exception 'This stage does not track production pieces';end if;
 if exists(select 1 from garments_erp.challan_job_item_pieces p join garments_erp.challan_job_item ci on ci.id=p.challan_job_item_id join garments_erp.variant_item vi on vi.id=p.variant_item_id join garments_erp.item_part ip on ip.id=vi.item_part_id join garments_erp.item_size_list sz on sz.id=p.item_size_list_id where ip.item_id<>sz.item_id or not exists(select 1 from garments_erp.variant_item_per_job link where link.job_id=ci.job_id and link.variant_item_id=vi.id)) then raise exception 'Challan variant and size must belong to its job';end if;
 return null;
end$$;
do $$declare tab text;begin foreach tab in array array['variant_item_per_job','stage_pieces','challan_job_item_pieces','challan_job_item','job','variant_item','item_part','item_size_list','stage'] loop
 execute format('create constraint trigger check_production_variant_links after insert or update or delete on garments_erp.%I deferrable initially deferred for each row execute function garments_erp.check_production_variant_links()',tab);
end loop;end$$;
create function garments_erp.keep_job_stage_identity() returns trigger language plpgsql security invoker set search_path='' as $$
begin if NEW.stage_id<>OLD.stage_id then raise exception 'A stage change requires a new job row';end if;return NEW;end$$;
create trigger keep_job_stage_identity before update of stage_id on garments_erp.job for each row execute function garments_erp.keep_job_stage_identity();
revoke all on function garments_erp.check_production_variant_links(),garments_erp.keep_job_stage_identity() from public,anon,authenticated;
update garments_access.app_db_table set table_name='variant_item_per_job' where schema_name='garments_erp' and table_name='design_per_job';
commit;
