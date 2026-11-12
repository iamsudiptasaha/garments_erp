ALTER TABLE garments_erp.variant ADD CONSTRAINT variant_item_part_design_color_key UNIQUE NULLS NOT DISTINCT (item_part_id, design_id, color_map_id);
