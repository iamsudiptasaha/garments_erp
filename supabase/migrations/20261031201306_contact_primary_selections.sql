-- One optional primary of each kind per contact. Existing rows stay non-primary.
-- No changes to contact ownership, foreign keys, RLS or grants.
begin;
alter table garments_erp.contact_items add column primary_address boolean not null default false;
alter table garments_erp.contact_items add column primary_phone boolean not null default false;
alter table garments_erp.contact_bank_account add column primary_bank_account boolean not null default false;

-- Partial unique indexes also enforce the rule under concurrent writes.
create unique index contact_items_one_primary_address
 on garments_erp.contact_items (contact_id) where primary_address;
create unique index contact_items_one_primary_phone
 on garments_erp.contact_items (contact_id) where primary_phone;
create unique index contact_bank_account_one_primary
 on garments_erp.contact_bank_account (contact_id) where primary_bank_account;
commit;
