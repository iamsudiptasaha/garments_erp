begin;
do $$ declare f jsonb;begin
 select data into strict f from public.ci_edition_backfill_fixture;
 if (select count(*) from garments_erp.dyeing_program_item where id in((f->>'first')::bigint,(f->>'second')::bigint))<>2
  or (select count(distinct dyeing_program_lab_dip_id) from garments_erp.dyeing_program_item where dyeing_program_id=(f->>'program')::bigint)<>1
  or not exists(select 1 from garments_erp.dyeing_program_lab_dip where dyeing_program_id=(f->>'program')::bigint and lab_dip_id=(f->>'lab')::bigint and lab_dip_version_id=(f->>'v1')::bigint and batch_no is null)
 then raise exception 'TEST backfill lost identities or selected the wrong edition/version';end if;
end $$;
commit;
