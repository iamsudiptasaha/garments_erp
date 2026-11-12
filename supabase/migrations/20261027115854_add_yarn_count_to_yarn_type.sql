ALTER TABLE garments_erp.yarn_type ADD COLUMN yarn_count text;
COMMENT ON COLUMN garments_erp.yarn_type.yarn_count IS 'Yarn count designation, for example 30S. Used with fabric type to derive the fabric display name. NULL until confirmed for existing yarn types.';
