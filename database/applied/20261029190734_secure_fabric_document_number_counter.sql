begin;
alter table garments_erp.document_number_counter enable row level security;
revoke all on table garments_erp.document_number_counter from public,anon,authenticated;
commit;
