# Fabric implementation and database mapping

The Fabric app is available at `/` and `/fabric.html`. The earlier standalone table trial remains at `/fortune.html`, with Univer and Tabulator comparisons preserved at `/univer.html` and `/tabulator.html`.

## Implemented locally

The new Fabric workspace has an expandable sidebar, Overview and protected Sheet on all ten pages, document-level Add/Edit + review/confirmation, filtering, whole-record sorting with a heading marker, record-based formatting, sizing/freezing, CSV and formatted print preview. Page metadata lives in `src/fabric/catalog.js`; linked records, validation and projections live in `domain.js`; shared forms are in `editor.js`; the FortuneSheet adapter is in `sheet.js`. Existing spreadsheet logic is reused through `fortune-state.js`; reports share one native-export adapter.

The local data model uses the actual parent/child table names and foreign-key field names. Header + all lines are copied, validated together, and only then replace the prior snapshot. This is local atomicity, not a database transaction. Replacing a referenced line or moving a line from another parent is rejected. A duplicate knitting invoice for the same knitter opens as an edit rather than creating an unrelated parent (the form rejects duplicate creation).

| Page | Parent | Children / source |
| --- | --- | --- |
| Suppliers | `contacts` | `yarn_supplier`, `knitter`, `dyer` through `contacts_id` |
| Yarn purchase orders | `yarn_purchase_order` | `yarn_purchase_order_item.purchase_order_number_id` |
| Yarn bills | `yarn_bill` | `yarn_bill_item.yarn_bill_id`, linked to purchase-order items |
| Knitting bills | `knitting_bill` | `knitting_bill_item.knitting_bill_id`, linked to yarn bill items and fabric types |
| Dyeing programs | `dyeing_program` | `dyeing_program_item.dyeing_program_id`; colour sections group lines by colour + comments |
| Dyed fabric bills | `dyed_fabric_bill` | `dyed_fabric_item.dyed_fabric_bill_id`, linked to knitting and program items |
| Dyed fabrics | projection | batch, derived fabric name, colour, invoice, billed kg, wastage and agreed final price |
| Yarn left | projection | billed quantity minus linked knitting consumption per yarn bill item |
| Greige left | projection | knitted quantity minus linked dyeing gross quantity, grouped by knitting bill + fabric name |
| Batch traceability | projection | yarn receipt → knitting line → program/colour → dyed receipt |

Greige report cells contain comma-separated dyers, and the remaining kg is a column on each group. `gross_quantity` means greige consumed. Fabric names derive from yarn count + fabric type. The prototype uses the previously agreed price interpretation `(yarn rate + knitting rate + dyeing rate) * (1 + (gross - billed) / gross)`; zero gross yields unavailable wastage/price rather than division by zero.

Colours is a separate expandable top-level section, outside Fabric. Colour library edits `color_map` (name, Pantone and physical-swatch flag); Colour mappings edits `color_map_by_brand` (colour, brand, optional dyer, shade-card number/option/image reference). Both have Overview and protected Sheet views. `brand_list` supplies brand choices. Program pickers join those records and restrict dyer-specific mappings to the selected dyer. Existing local fixtures are upgraded without changing document or mapping IDs. Shade-card image is currently a text reference; authenticated file uploads remain deferred. Local IDs are strings; live Postgres bigint identities must be mapped consistently without unsafe numeric coercion.

## Live database audit (read-only, 27 October 2026)

Confirmed parent/child FKs and existing data. No schema/data changes were made.

- `knitting_bill` already supports many `knitting_bill_item` records. One bill header contains knitter, invoice and date. The old table-trial flat form did not represent that relationship; the Fabric app does.
- `view_knitted_fabric_name` already derives names using `yarn_count`. Some live yarn types may still need their count populated; do not invent it from a supplier name.
- `dyed_fabric_item.batch_no` has a UNIQUE constraint. `dyeing_program_item.batch_no` references it. The current local validator respects unique dyed-item batches. Whether multiple fabric rows should share the same physical batch requires a schema decision before live write integration. The app does not silently remove the constraint or fabricate a separate batch table.
- Colour comments currently live on each program item. The form presents an outer colour section and writes its comments to all contained rows, retaining the existing schema.
- Audited contacts, employee and Fabric business tables have anonymous SELECT grants, RLS disabled and no policies. These grants alone do not prove that the schema is exposed through the configured Data API, but a deployed browser client must not assume the grants are safe.

## Explicitly deferred by the user

Roles are to be created after Fabric review. Therefore this app intentionally has no live browser client, publishable key, database writes, login, shared saving or deployment. Sample records and presentation persist only in browser storage. The shared-formatting requirement remains: record ID + field style must be stored centrally for all authorised users, while sort/filter/width/freeze preferences are personal. Browser storage is not represented as shared persistence.

Before live pilot: confirm employee authentication and role policies, secure exposed tables, define transactional save RPCs with stale-write checks, review the batch relation, add shared formatting storage and authenticated attachments, then validate against a non-production dataset. Do not use service-role credentials in the frontend or make separate unguarded parent/child REST writes.


## Mapping-dependent program batch selection

The colour section requires `color_map_by_brand_id`; `batch_no` remains optional and saves as SQL-compatible null when blank. Every fabric row in that colour/batch section receives those values. On edit, rows with different batch values remain separate sections. Changing a mapping clears its selected batch. The validator rejects a non-null batch that is absent from that mapping's receipt history.

The existing database relationship used to populate choices is:

```sql
select distinct receipt.batch_no
from garments_erp.dyed_fabric_item as receipt
join garments_erp.dyeing_program_item as source_program_line
  on source_program_line.id = receipt.dyeing_program_item_id
where source_program_line.color_map_by_brand_id = $1
order by receipt.batch_no;
```

`$1` is the selected mapping ID; it is not the colour master ID or name. This is a parameterised query specification for the live adapter, not a schema migration. Read-only schema inspection confirmed that `dyeing_program_item.batch_no` already references the unique `dyed_fabric_item.batch_no`; no duplicate batch column/table is needed. Local implementation uses the same join path over schema-shaped records.

Colour mappings display attached-swatch status by joining `color_map_by_brand.color_map_id` to `color_map.attached_swatch`. The flag stays editable only on the colour master and appears in mapping Overview, Sheet and export/print columns.
