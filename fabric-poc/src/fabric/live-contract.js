// Reviewed writable fields. Database-generated fields and attachment slots are excluded.
export const fabricContract={
  "yarnTypes": {
    "yarn_type": [
      "name",
      "yarn_count"
    ]
  },
  "fabricTypes": {
    "fabric_type": [
      "name"
    ]
  },
  "brands": {
    "brand_list": [
      "brand",
      "contacts_id",
      "contact_purpose_id"
    ]
  },
  "colours": {
    "color_map": [
      "name",
      "pantone_code"
    ]
  },
  "colourMappings": {
    "color_map_by_brand": [
      "color_map_id",
      "brand_list_id"
    ]
  },
  "labDips": {
    "lab_dip": [
      "date",
      "edition",
      "color_map_by_brand_id",
      "dyer_id"
    ],
    "lab_dip_version": [
      "lab_dip_id",
      "version",
      "date",
      "shade_card_no",
      "shade_card_option",
      "comments",
      "lab_dip_status_id",
      "attached_swatch"
    ]
  },
  "suppliers": {
    "contacts": [
      "company_name"
    ],
    "yarn_supplier": [
      "contacts_id",
      "contact_purpose_id"
    ],
    "knitter": [
      "contacts_id",
      "contact_purpose_id"
    ],
    "dyer": [
      "contacts_id",
      "contact_purpose_id"
    ]
  },
  "orders": {
    "yarn_purchase_order": [
      "yarn_supplier_id"
    ],
    "yarn_purchase_order_item": [
      "purchase_order_number_id",
      "yarn_type_id",
      "quantity",
      "rate"
    ]
  },
  "yarn": {
    "yarn_bill": [
      "invoice_number",
      "invoice_date"
    ],
    "yarn_bill_item": [
      "yarn_bill_id",
      "yarn_purchase_order_item_id",
      "billed_quantity",
      "billed_rate",
      "billed_bags"
    ]
  },
  "knitting": {
    "knitting_bill": [
      "invoice_number",
      "invoice_date",
      "knitter_id"
    ],
    "knitting_bill_item": [
      "knitting_bill_id",
      "yarn_bill_item_id",
      "fabric_type_id",
      "greige_gsm",
      "consumption",
      "billed_quantity",
      "billed_rate",
      "billed_rolls"
    ]
  },
  "programs": {
    "dyeing_program": [
      "date",
      "dyer_id"
    ],
    "dyeing_program_item": [
      "dyeing_program_id",
      "fabric_type_id",
      "quantity",
      "lab_dip_version_id",
      "batch_no",
      "comments"
    ]
  },
  "dyeBills": {
    "dyed_fabric_bill": [
      "invoice_number",
      "invoice_date"
    ],
    "dyed_fabric_item": [
      "dyed_fabric_bill_id",
      "dyeing_program_item_id",
      "knitting_bill_item_id",
      "gross_quantity",
      "billed_quantity",
      "final_quantity",
      "dyeing_rolls",
      "dyeing_rate"
    ],
    "batch_no_lab_dip_version_map": [
      "dyed_fabric_item_id",
      "batch_no",
      "lab_dip_version_id"
    ]
  },
  "dyed": {},
  "yarnLeft": {},
  "greige": {},
  "batches": {}
};
export const fabricColumnTypes={
  "yarn_type": {
    "id": "bigint",
    "name": "text",
    "created_at": "timestamp with time zone",
    "yarn_count": "text",
    "updated_at": "timestamp with time zone"
  },
  "fabric_type": {
    "id": "bigint",
    "name": "text",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "brand_list": {
    "id": "bigint",
    "contact_purpose_id": "bigint",
    "contacts_id": "bigint",
    "brand": "text",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "color_map": {
    "id": "bigint",
    "name": "text",
    "pantone_code": "text",
    "attached_swatch": "boolean",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "color_map_by_brand": {
    "id": "bigint",
    "color_map_id": "bigint",
    "brand_list_id": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "lab_dip": {
    "id": "bigint",
    "date": "date",
    "edition": "integer",
    "color_map_by_brand_id": "bigint",
    "dyer_id": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "lab_dip_version": {
    "id": "bigint",
    "lab_dip_id": "bigint",
    "version": "integer",
    "date": "date",
    "shade_card_no": "text",
    "shade_card_option": "text",
    "comments": "text",
    "shade_card_image_attachment": "bigint",
    "lab_dip_status_id": "bigint",
    "attached_swatch": "boolean",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "contacts": {
    "id": "bigint",
    "gst": "text",
    "company_name": "text",
    "search_term": "text",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "yarn_supplier": {
    "id": "bigint",
    "contact_purpose_id": "bigint",
    "contacts_id": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "knitter": {
    "id": "bigint",
    "contact_purpose_id": "bigint",
    "contacts_id": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "dyer": {
    "id": "bigint",
    "contact_purpose_id": "bigint",
    "contacts_id": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "yarn_purchase_order": {
    "id": "bigint",
    "purchase_order_number": "text",
    "yarn_supplier_id": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "yarn_purchase_order_item": {
    "id": "bigint",
    "purchase_order_number_id": "bigint",
    "yarn_type_id": "bigint",
    "rate": "numeric",
    "quantity": "numeric",
    "fabric_status_list_id": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "yarn_bill": {
    "id": "bigint",
    "invoice_date": "date",
    "invoice_number": "text",
    "bill_attachment": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "yarn_bill_item": {
    "id": "bigint",
    "yarn_bill_id": "bigint",
    "yarn_purchase_order_item_id": "bigint",
    "billed_rate": "numeric",
    "billed_quantity": "numeric",
    "billed_bags": "numeric",
    "fabric_status_list_id": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "knitting_bill": {
    "id": "bigint",
    "knitter_id": "bigint",
    "invoice_date": "date",
    "invoice_number": "text",
    "bill_attachment": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "knitting_bill_item": {
    "id": "bigint",
    "knitting_bill_id": "bigint",
    "fabric_type_id": "bigint",
    "yarn_bill_item_id": "bigint",
    "greige_gsm": "numeric",
    "billed_rate": "numeric",
    "consumption": "numeric",
    "billed_quantity": "numeric",
    "billed_rolls": "numeric",
    "fabric_status_list_id": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "dyeing_program": {
    "id": "bigint",
    "date": "timestamp with time zone",
    "program_number": "text",
    "dyer_id": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "dyeing_program_item": {
    "id": "bigint",
    "fabric_type_id": "bigint",
    "dyeing_program_id": "bigint",
    "quantity": "numeric",
    "comments": "text",
    "batch_no": "text",
    "created_at": "timestamp with time zone",
    "lab_dip_version_id": "bigint",
    "updated_at": "timestamp with time zone"
  },
  "dyed_fabric_bill": {
    "id": "bigint",
    "invoice_date": "date",
    "invoice_number": "text",
    "bill_attachment": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "dyed_fabric_item": {
    "id": "bigint",
    "dyed_fabric_bill_id": "bigint",
    "dyeing_program_item_id": "bigint",
    "knitting_bill_item_id": "bigint",
    "description": "text",
    "dyeing_rate": "numeric",
    "gross_quantity": "numeric",
    "billed_quantity": "numeric",
    "dyeing_rolls": "numeric",
    "final_quantity": "numeric",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "batch_no_lab_dip_version_map": {
    "id": "bigint",
    "dyed_fabric_item_id": "bigint",
    "batch_no": "text",
    "lab_dip_version_id": "bigint",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "contact_purpose": {
    "id": "bigint",
    "type": "text",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  },
  "lab_dip_version_status": {
    "id": "bigint",
    "status": "text",
    "created_at": "timestamp with time zone",
    "sort_order": "integer",
    "updated_at": "timestamp with time zone"
  },
  "fabric_status_list": {
    "id": "bigint",
    "name": "text",
    "title": "text",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone"
  }
};
