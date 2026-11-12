-- Applied through Supabase migration rename_bucket_group_registry.
alter table garments_erp.bucket_group_id rename to bucket_group;
-- attachments.bucket_group_id remains the FK column; Postgres preserves its
-- reference to the renamed table automatically.
