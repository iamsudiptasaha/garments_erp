-- Read-only schema metadata. No business records or Auth data.
select table_schema, table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema in ('garments_erp', 'garments_access')
order by table_schema, table_name, ordinal_position;
