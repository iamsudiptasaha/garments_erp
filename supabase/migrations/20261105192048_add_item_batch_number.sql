-- Optional item batch reference. Existing items remain unknown (NULL).
begin;
set local lock_timeout = '10s';
alter table garments_erp.item add column batch_number text;
comment on column garments_erp.item.batch_number is 'Optional manually entered item batch reference; not a generated or unique identifier.';
commit;
