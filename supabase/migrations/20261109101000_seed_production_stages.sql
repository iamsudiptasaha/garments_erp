begin;

set local lock_timeout = '10s';

-- Fabric.drawio, Feature sheet. Preserve existing IDs and reject conflicting
-- configuration so that a release cannot silently change an active workflow.
lock table garments_erp.stage_type, garments_erp.stage in share row exclusive mode;

insert into garments_erp.stage_type (name)
select expected.name
from (values ('Pre production'), ('yet to start'), ('Work in progress'), ('Complete')) expected(name)
where not exists (
  select 1 from garments_erp.stage_type existing
  where lower(existing.name) = lower(expected.name)
);

do $$
declare
  expected record;
  matching_type_id bigint;
  existing garments_erp.stage%rowtype;
begin
  for expected in
    select * from (values
      (1, 'Fit sampling', 'FIT', 'Pre production', false, true),
      (2, 'Develop CAD', 'CAD', 'Pre production', false, true),
      (3, 'Strike off', 'SO', 'Pre production', false, true),
      (4, 'Pre Production Sample', 'PPS', 'Pre production', false, true),
      (5, 'Ready for production', 'RFP', 'yet to start', true, false),
      (6, 'Cutting', 'CUT', 'Work in progress', true, false),
      (7, 'Printing', 'PRT', 'Work in progress', true, false),
      (8, 'Embroidery', 'EMB', 'Work in progress', true, false),
      (9, 'Stitching', 'STH', 'Work in progress', true, false),
      (10, 'Washing', 'WSH', 'Work in progress', true, false),
      (11, 'Finishing', 'FIN', 'Work in progress', true, false),
      (12, 'Quality Check', 'QC', 'Work in progress', true, false),
      (13, 'Ironing', 'IRN', 'Work in progress', true, false),
      (14, 'Packaging', 'PAC', 'Work in progress', true, false),
      (15, 'Ready to Dispatch', 'RTD', 'Complete', true, false)
    ) seed(sort_order, name, abbr, type_name, track_pieces, pp_stage)
  loop
    select id into strict matching_type_id from garments_erp.stage_type
    where lower(name) = lower(expected.type_name);

    if exists (
      select 1 from garments_erp.stage
      where (sort_order = expected.sort_order or lower(name) = lower(expected.name))
        and abbr <> expected.abbr
    ) then
      raise exception 'Conflicting production stage for %', expected.abbr;
    end if;

    select * into existing from garments_erp.stage where abbr = expected.abbr;
    if not found then
      insert into garments_erp.stage (name, abbr, sort_order, stage_type_id, track_pieces, pp_stage)
      values (expected.name, expected.abbr, expected.sort_order, matching_type_id,
        expected.track_pieces, expected.pp_stage);
    elsif (existing.name, existing.sort_order, existing.stage_type_id,
           existing.track_pieces, existing.pp_stage) is distinct from
          (expected.name, expected.sort_order, matching_type_id,
           expected.track_pieces, expected.pp_stage) then
      raise exception 'Conflicting production stage configuration for %', expected.abbr;
    end if;
  end loop;

  if exists (
    select 1 from garments_erp.stage s join garments_erp.stage_type t on t.id = s.stage_type_id
    where lower(t.name) = 'complete' and s.abbr <> 'RTD'
  ) then
    raise exception 'Ready to Dispatch must be the only Complete production stage';
  end if;
end;
$$;

commit;
