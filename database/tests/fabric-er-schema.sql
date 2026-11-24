-- Verify actual migrated PostgreSQL objects, not a projected JSON schema.
do $$ declare n integer;begin
 if not exists(select 1 from pg_attribute where attrelid='garments_erp.dyeing_program_lab_dip'::regclass and attname='source_dyeing_program_id' and atttypid='bigint'::regtype and not attnotnull) then raise exception 'TEST source column/type/nullability';end if;
 if not exists(select 1 from pg_constraint where conrelid='garments_erp.dyeing_program_lab_dip'::regclass and conname='dyeing_group_reuse_source' and confrelid=conrelid and condeferrable and condeferred and convalidated) then raise exception 'TEST missing deferred exact-edition source FK';end if;
 if not exists(select 1 from pg_constraint where conrelid='garments_erp.dyeing_program_item'::regclass and conname='dyeing_program_item_group_owner' and convalidated) then raise exception 'TEST item ownership FK';end if;
 if (select count(*) from pg_constraint where conrelid='garments_erp.fabric_plan_dyeing_link'::regclass and contype='p' and cardinality(conkey)=2)<>1 then raise exception 'TEST composite link identity';end if;
 select count(*) into n from pg_trigger where tgfoid='garments_erp.guard_fabric_provenance()'::regprocedure and not tgisinternal and tgenabled='O';
 if n<>6 then raise exception 'TEST incomplete provenance guard coverage: %',n;end if;
 if not exists(select 1 from pg_trigger where tgrelid='garments_erp.dyeing_program_lab_dip'::regclass and tgname='check_lab_dip_traceability' and tgdeferrable and tginitdeferred) then raise exception 'TEST graph validation must be deferred';end if;
 if to_regclass('garments_erp.dyeing_group_reuse_source') is null then raise exception 'TEST missing source lookup index';end if;
 if to_regprocedure('public.erp_set_fabric_plan_dyeing_link(bigint,bigint,boolean,text)') is not null then raise exception 'TEST unsafe legacy link signature retained';end if;
 if has_function_privilege('anon','public.erp_set_fabric_plan_dyeing_link(bigint,bigint,boolean,text,jsonb,numeric)','EXECUTE') or not has_function_privilege('authenticated','public.erp_set_fabric_plan_dyeing_link(bigint,bigint,boolean,text,jsonb,numeric)','EXECUTE') then raise exception 'TEST planner command grants';end if;
 if (select prosecdef from pg_proc where oid='public.erp_set_fabric_plan_dyeing_link(bigint,bigint,boolean,text,jsonb,numeric)'::regprocedure) then raise exception 'TEST public wrapper must be invoker';end if;
 if not (select relrowsecurity from pg_class where oid='garments_erp.dyeing_program_lab_dip'::regclass) or has_table_privilege('authenticated','garments_erp.dyeing_program_lab_dip','SELECT,INSERT,UPDATE,DELETE') then raise exception 'TEST private group authorization';end if;
 if not exists(select 1 from pg_class where oid='garments_erp.view_item_part_fabric_labdip_status'::regclass and 'security_invoker=true'=any(reloptions)) then raise exception 'TEST view RLS semantics';end if;
 if (select count(*) from pg_proc where oid in ('garments_erp.check_lab_dip_traceability()'::regprocedure,'garments_erp.check_fabric_plan_dyeing_links()'::regprocedure) and 'plan_cache_mode=force_custom_plan'=any(proconfig))<>2 then raise exception 'TEST scoped validation plan configuration';end if;
 if position('fabric_linked_required_kg' in pg_get_functiondef('garments_erp.save_fabric_document_core(text,jsonb,text,jsonb,bigint)'::regprocedure))=0 or position('fabric_linked_required_kg' in pg_get_functiondef('garments_erp.set_fabric_plan_dyeing_link(bigint,bigint,boolean,text,jsonb,numeric)'::regprocedure))=0 then raise exception 'TEST duplicated or disconnected quantity calculation';end if;
 if exists(select 1 from pg_constraint where connamespace='garments_erp'::regnamespace and not convalidated) then raise exception 'TEST unvalidated constraint';end if;
end $$;
