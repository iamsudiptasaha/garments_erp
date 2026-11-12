begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function garments_access.stamp_updated_at()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='INSERT' then NEW.updated_at:=clock_timestamp();
 elsif (to_jsonb(NEW)-'updated_at') is distinct from (to_jsonb(OLD)-'updated_at') then NEW.updated_at:=clock_timestamp();
 else NEW.updated_at:=OLD.updated_at;
 end if;
 return NEW;
end$$;
revoke all on function garments_access.stamp_updated_at() from public,anon,authenticated;
do $$declare tab record;begin
 for tab in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('garments_erp','garments_access') and c.relkind='r' order by n.nspname,c.relname loop
 execute format('alter table %I.%I add column updated_at timestamptz',tab.nspname,tab.relname);
 -- Set the default only after adding the nullable column: never fabricate old update dates.
 execute format('alter table %I.%I alter column updated_at set default now()',tab.nspname,tab.relname);
 execute format('comment on column %I.%I.updated_at is %L',tab.nspname,tab.relname,'Database-managed last meaningful row change. NULL on legacy rows means the historical update time is unknown.');
 execute format('create trigger zz_stamp_updated_at before insert or update on %I.%I for each row execute function garments_access.stamp_updated_at()',tab.nspname,tab.relname);
 end loop;
end$$;
commit;
