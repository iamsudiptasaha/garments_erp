-- Disposable database contract; no persistent fixture data.
\set ON_ERROR_STOP on
begin;
do $$declare sample bigint;begin
 if not exists(select 1 from information_schema.columns where table_schema='garments_erp' and table_name='item' and column_name='batch_number' and data_type='text' and is_nullable='YES') then
  raise exception 'Item batch number must be optional text';
 end if;
 insert into garments_erp.item(id,style_code) values(980010,'Batch reference contract') returning id into sample;
 if (select batch_number is not null from garments_erp.item where id=sample) then raise exception 'Existing item batches must remain unknown';end if;
 update garments_erp.item set batch_number='0001/A' where id=sample;
 if (select batch_number is distinct from '0001/A' from garments_erp.item where id=sample) then raise exception 'Batch number must preserve text';end if;
 update garments_erp.item set batch_number=null where id=sample;
end $$;
rollback;
