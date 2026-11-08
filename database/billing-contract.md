# Billing, packing and dispatch

Each invoice uses a single sale mode. Each billing line has one PO item. Several lines or invoices can draw from the same PO item. A billed size row stores the actual physical quantity. Standard lines additionally store the variation, price version, set count, set price and component weights. Exception lines store the entered price per piece.

| Invoice status | Inventory effect | Allowed actions |
| --- | --- | --- |
| Draft | Holds stock and PO allowance | Save or remove lines, finalize, cancel |
| Cancelled | Releases stock and PO allowance | Read retained records |
| Finalized | Counts as sold and uses PO allowance | Pack, amend eligible lines, dispatch cartons |
| Dispatched | Counts as sold and uses PO allowance | Record verified returns |

`billing → packing_list → carton → carton_item` connects invoices to physical cartons. Standard allocations store whole sets. Exception allocations reference billed size rows through `carton_item_piece_per_size`. The unique `transport_item.carton_id` assigns a carton to one transport. The unique `transport_docket.transport_id` permits one docket per transport.

The pickup command dispatches the transport and validates complete packing in the same transaction. A shipped carton freezes its billed lines. The invoice becomes dispatched once every carton has shipped. Returns reference billed size rows, restore inventory upon employee verification and leave PO allowance unchanged.

The service uses `erp_billing_command`, `erp_pack_billing_carton`, `erp_dispatch_transport` and `erp_verify_billing_return` for writes. Read operations use `erp_billing_stock` and `erp_billing_po_allowance`. Billing commands record employee, request and before/after state. Stock checks reuse the Finished Products calculation and lock manufactured item rows. PO allocations additionally lock the affected PO items. Existing invoices and returns require explicit lifecycle reconciliation before this migration can run.

## Sellable product catalogue

`sellable_product` replaces the commercial parent and variation tables. Its ID
is the former variation ID. Composition, PO lines, billing lines and
`item_in_store_price` reference it through `sellable_product_id`. The pricing
table and historical prices retain their existing identities.

The catalogue owns its text SKU, style code, date, verification and activity.
The migration preserves original parent values in read-only `legacy_parent`
metadata and carries forward effective activity. It stops on unmapped records,
duplicate copied SKUs or an active verified variation with an unverified parent.
Existing RPC payload keys such as `variation_id` continue to identify the same
sellable product.


## PO–Billing redesign pricing

For both formal PO and ad-hoc standard billing, the operator must type the final
unit price. A selected price version can provide a suggestion. The invoice
stores the explicitly entered price and may retain the selected version as
provenance. Formal PO prices and invoice prices are independent. The billing
command requires an explicit price even when a version is selected. The future
billing UI enforces manual entry, since the database cannot distinguish typing
from an autofilled value.

For ad-hoc billing, the generated PO mirrors the invoice price, quantities and
composition. The billing transaction writes the PO first and the invoice second.
Cancellation preserves both records and prevents reuse of the PO. Line removal
removes the corresponding generated PO line in the same transaction and retains
its prior state in the audit history.


Ad-hoc line saves require `product_type_list_id` and an `hsn_by_size` object
keyed by `item_size_list.id`. HSN values are nonblank strings so leading zeroes
are preserved. The command stores the product type on the generated PO line
and the HSN on each corresponding PO size row. The existing product type
lookup must be populated before ad-hoc billing is used.

### Returns

`erp_verify_billing_return(request_id, billing_id, employee_id, lines)` remains a service-role RPC and records and verifies the return atomically. Each return line refers to one original billing line. A return can contain both modes.

- Set lines accept `mode: "set"`, `billing_item_id`, `returned_units`, `unit_price` and optional `reason_id`. The RPC copies the original product and expands the frozen billed size rows. Component prices are null because the price is recorded per set.
- Piece lines accept `mode: "piece"`, `billing_item_id`, optional `reason_id` and a `pieces_by_size` array containing `billed_piece_id`, `pieces` and `price`. The original flat component format remains accepted for existing integrations.
- Verified child quantities restore stock. Set and piece returns share the original billed-component limit. The invoice lock serializes concurrent returns and a request ID can only be retried with the same employee and payload. PO allowance is unaffected.
- Existing return lines retain their IDs, reasons and timestamps. Their quantities and prices move to size rows, and their original verification state continues to determine their inventory effect.
