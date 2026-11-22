# Raw Material Inventory local pilot

Read-only inspection of `garments_erp` confirmed the existing raw-material tables, fields and foreign keys. No live records, grants or schema were changed. This module reuses the Fabric shell, Overview/Sheet toggle, protected FortuneSheet, formatting, CSV/print, forms and confirm step. Module metadata, projections, validation and cards are in `fabric-poc/src/inventory/`.

## Screens and table mapping

| Screen | Source |
| --- | --- |
| Stock available | Receipt quantity minus all linked check-outs, per receipt/SKU |
| Movement history | Receipts and issues with direction, quantity and unit |
| Materials | `raw_material_item` with category, unit, preferred supplier and description |
| Material suppliers | `raw_material_supplier_list` joined to contacts and contact purpose |
| Material purchase orders | `raw_material_purchase_order` header with many `raw_material_purchase_order_item` lines |
| Stock receipts | `raw_material_check_in` with material OR dyed-fabric item, date, quantity, price, SKU, supplier, order, invoice and verifier |
| Stock issues | `raw_material_check_out` linked to receipt, with date, quantity, type, recipient, issuer, item-part and remarks |
| Supplier contacts | `contacts.company_name`; preserves other existing attributes on edit |
| Material categories | `category_list` |
| Units of measure | `unit_of_measure` |
| Issue types | `check_out_type` |

The schema enforces exactly one raw material or dyed-fabric item per receipt. Fabric receipts show the existing batch and derived fabric name. Total receipts for a batch cannot exceed its `final_quantity`, the physically received quantity. Issue quantities must be positive and cannot exceed available receipt stock. A receipt with issues cannot switch sources, and a material with recorded quantities cannot switch its unit ID. Renaming a unit label does not perform a quantity conversion.

PO receipt matching uses purchase-order ID + material ID because the schema links receipts to the PO header, not a PO line. The pilot therefore requires one line per material on a PO. Over-receipt is shown separately; it does not produce negative “to receive” quantities. Quantity summaries are grouped by unit. Price values are displayed as the schema's `price` without imposing a tax/cost formula.

## Reconciliation agreed with the user

“Reconcile & close” writes a new `raw_material_check_out` with `reconciliation=true` and quantity equal to the entire remaining receipt balance, bringing it to zero. The date, recording employee and reason are captured and reviewed before saving. Existing receipts/issues remain unchanged. Reconciliation entries are marked explicitly in movement history and are not editable in this initial pilot. Reopening/correcting a reconciliation needs a subsequent agreed workflow; the app does not erase history or invent negative return issues. A second closing operation on zero stock is rejected. The nullable issue-type FK may remain null because the reconciliation flag supplies its meaning.

## Boundaries

All records are local sample data in browser storage, including example category/unit/issue types. HR supplies employee choices; no duplicate employee editor exists in inventory. Item/part choices read the schema-shaped `item`, `item_part`, `part_list` collections and remain empty until Production provides those records. Supplier contacts can be added locally; optional transport choices remain empty in the demo. Existing bill-attachment IDs are displayed and preserved; file upload awaits authenticated Storage integration. These dependencies are not replaced with free-text foreign keys.

New inventory permission resources are listed in Administration; existing custom roles get no automatic grants. Administrator sees the new screens. Auth, database RBAC, transactional live persistence, shared formatting, attachments and cross-user concurrency are still pending. Existing browser workspaces gain the sample inventory collections without changing Fabric records or IDs.

## Receipt flow correction

The receipt form now starts with **Purchase order** or **Fabric**. The PO path asks for the order, restricts supplier to that order's supplier, and enables ordered-item choices after supplier selection. Selecting a different order clears supplier/item. The Fabric path offers batch selection and saves supplier, purchase order and ordered-item FK as null. Switching paths clears all incompatible source values. SKU is displayed as automatic for new entries; existing identifiers are retained. Labels use inward date, billed quantity and billed price while the live fields remain `date`, `quantity`, `price`.

The misc diagram now links receipts to `raw_material_purchase_order_item`. Read-only Supabase inspection confirmed the live table still has only the PO-header FK (`purchase_order_id`); supplier is already nullable. Local receipts now capture `raw_material_purchase_order_item_id` alongside the legacy header/material IDs. Existing local rows infer a line only when the match is unambiguous. `database/drafts/stock-receipt-order-item.sql` prepares the additional FK and unambiguous backfill for review; it has **not** been applied. The live adapter must not send this new field before that migration is approved and applied.

## Transferable Materials development implementation

The approved sibling page, receipt flag, append-only movements, database safeguards and verification are documented in [Transferable Materials](transferable-materials.md). Its explicit reviewed ownership contract replaces the prior Inventory source freeze for this authorized feature. Existing pages and routes are retained. No production release is authorized.
