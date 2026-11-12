CREATE VIEW garments_erp.view_knitting_bill_item_details
WITH (security_invoker = true) AS
SELECT
    kbi.*,
    yt.id AS yarn_type_id,
    yt.name AS yarn_type_name,
    yt.yarn_count,
    ft.name AS fabric_type_name,
    CASE
        WHEN NULLIF(BTRIM(yt.yarn_count), '') IS NOT NULL
         AND NULLIF(BTRIM(ft.name), '') IS NOT NULL
        THEN BTRIM(yt.yarn_count) || ' ' || BTRIM(ft.name)
        ELSE NULL
    END AS fabric_name
FROM garments_erp.knitting_bill_item AS kbi
LEFT JOIN garments_erp.yarn_bill_item AS ybi
    ON ybi.id = kbi.yarn_bill_item_id
LEFT JOIN garments_erp.yarn_purchase_order_item AS ypoi
    ON ypoi.id = ybi.yarn_purchase_order_item_id
LEFT JOIN garments_erp.yarn_type AS yt
    ON yt.id = ypoi.yarn_type_id
LEFT JOIN garments_erp.fabric_type AS ft
    ON ft.id = kbi.fabric_type_id;
