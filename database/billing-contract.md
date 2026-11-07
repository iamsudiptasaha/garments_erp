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
