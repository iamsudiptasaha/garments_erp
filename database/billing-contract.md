# Billing, packing and dispatch

## Confirmed workflow

- **Invoice number** is entered manually. A draft can be saved without a number. Finalization requires a nonblank number unique among finalized, non-cancelled invoices, including dispatched invoices. Drafts do not reserve numbers. Cancelled numbers can be reused, and audit history retains them.
- **Formal billing** starts by selecting one existing buyer PO. The invoice derives its buyer from that PO. Every invoice line must reference an item belonging to the selected PO. A PO can contain Standard and Exception lines and support multiple partial invoices. The operator chooses an invoice sale mode from the selected PO’s line modes. The invoice shows only eligible lines in that mode. Active draft reservations and issued quantities share the cumulative allowance.
- **PO items** must resolve to existing ERP-produced items. For standard sales, the operator enters the number of sets ordered. The verified sellable-product recipe determines the size-level components and quantities. PO entry does not allow recipe overrides. For exception sales, the selected ERP item sizes identify the pieces. Only ERP items with recorded production stock-in are eligible for PO selection. Billing rechecks available stock for the selected quantities.
- **Ad-hoc billing** starts by selecting the buyer directly and requires no existing PO. The existing internally generated PO can preserve the line and allowance relationships. Its continued use is proposed below.
- **Returns** start at one whole physical ERP item. Each piece is linked to its original billed size row, including pieces sold as part of a set. For standard sales, suggest the original invoiced set price divided by the total physical pieces per set, using the sum of the original billed component weights. A ₹300 set with two tops and one pant suggests ₹100 per piece. For exception sales, suggest the original invoiced price on the billed size row.
- **Credit limits** apply to the operator-confirmed price. It must be nonnegative and cannot exceed the original invoiced set price for a standard component or the original invoiced piece price for an exception piece. Cumulative verified credits across the invoice cannot exceed its original pre-GST billed value. Each billed size row also retains its cumulative physical quantity limit.
- **Return verification** restores the corresponding physical quantities and reduces taxable value by the confirmed credit. Original sale quantities, prices and PO allowance are preserved. Use existing numeric and display conventions without additional accounting-specific rounding rules.
- **GST** is entered by the operator as an invoice percentage. Display taxable value after verified returns, GST on that value, and the GST-inclusive total.
- **Permissions** follow the relevant page access. The server derives the verifying employee from the authenticated user for invoice finalization and return verification. Verification identity is read-only in the portal and cannot be supplied by the caller.
- **Accounting** reconciliation and payment workflows are deferred. Net billed value tracks verified returns against an invoice independently of payment activity.

## Local database implementation

The [Billing PO migration](../supabase/migrations/20261112044630_bind_billing_to_purchase_order.sql)
binds each invoice to exactly one formal or generated PO. Formal invoice creation
takes a PO and a single mode and derives the buyer. A database trigger guards
line ownership. Existing line-level sale-mode foreign keys and allowance locks
remain in use. A partial unique index claims trimmed invoice numbers at issue.
Draft headers can store GST and an optional invoice number. Issued invoices
require both. Return verification applies price and cumulative credit ceilings
under the invoice lock. The server calculates taxable value and GST from verified
returns. The migration has been tested locally. The [portal migration](../supabase/migrations/20261112045449_billing_portal_access.sql)
adds authenticated RPCs for creating Buyer POs, listing and reading invoices,
saving an invoice atomically, dispatching an existing transport, and verifying
piece returns. Each RPC checks its own page access and derives the employee from
the current session. Invoice and PO creation support idempotent retries and
record the actor in the existing audit trail. The invoice list, detail, shared
worksheet and editor call the authenticated read and write RPCs.

The local portal includes Buyer PO, invoice creation and editing, Packing Lists,
Cartons, Dispatch, piece Returns and Billing Summary. Mutations use the
authenticated employee, operation permission and existing audit trail. Verified
returns update physical stock and invoice GST through the existing database
formulas.

The [docket migration](../supabase/migrations/20261112052422_billing_transport_docket_independence.sql)
copies every legacy docket-to-bill association into `transport_bill_item` before
removing the mandatory legacy column. Existing item amounts and docket fields are
preserved. New dockets reference their transport and can be recorded before
accounting assigns a bill. A conflicting dependency aborts the migration.

Run `bash scripts/ci/test-billing-local.sh` for the disposable SQL and HTTP
suites. Add `BILLING_TEST_CHROMIUM=1` for the browser workflow against the same
database, including mixed-mode PO creation, two partial invoices, packing,
dispatch, a partial return, stock restoration and GST. The browser runner
uses seeded test sessions and routes requests to the disposable PostgREST API.

## Deployed behavior and local changes

| Area | Live behavior | Proposed change |
| --- | --- | --- |
| Invoice number | `billing.invoice_number` is unique and non-null. The create command takes the number and finalization does not set it. | Allow null draft numbers and normalize blank input. Replace global uniqueness with database-enforced uniqueness scoped to finalized and dispatched invoices. Require a nonblank number and claim it in the same transaction as finalization so concurrent attempts cannot both succeed. Preserve cancelled numbers in retained records and audit history. The current RPC only cancels drafts. |
| Formal PO | The invoice stores a buyer and an optional ad-hoc PO. The RPC checks that each formal line belongs to the same buyer, so lines from different POs for that buyer can coexist. | Persist the selected formal PO, derive the buyer server-side, and enforce PO ownership for every line in the RPC and database. Keep formal and ad-hoc sources mutually exclusive. |
| PO item eligibility | Standard lines reference the sellable catalogue and exception quantities reference ERP item sizes. Those links alone do not establish that a PO item meets the required production eligibility. | Check recorded production stock-in for the underlying ERP items when listing eligible options and saving PO lines, including the ad-hoc generated PO. Use production records for eligibility and the current size-level stock balance and PO allowance for billing. |
| Ad-hoc source | The command takes a buyer and generates a dedicated PO internally. | Keep the generated PO as a system-owned record. The operator selects only the buyer at invoice creation. Retain atomic PO and invoice writes and the current product type and HSN requirements. |
| Return value | The return RPC supports both set and piece modes and accepts caller-supplied prices. It enforces cumulative billed quantities but does not enforce an original-price ceiling or cumulative monetary cap. | Use the existing piece-return path for new returns. Calculate suggestions from frozen billed prices and composition, store the confirmed price on each returned size row, and enforce both price ceilings and the invoice-wide credit cap in the same transaction as verification under the existing invoice lock. Include historical verified set-mode credits in the cumulative value using their stored set quantities and confirmed set prices. Preserve historical return records and the existing verified size-level stock calculation. |
| GST | The invoice has a nullable `gst_percentage` field, but the current command does not write it or calculate the adjusted totals. | Accept and validate the entered percentage, persist it with the invoice, and use that stored rate to recalculate GST and the total from taxable value after verified returns. Keep return credits on a pre-GST basis to avoid deducting GST twice. |
| Access and identity | The Billing RPCs are service-role only. The service supplies an employee ID, and the repository has no Billing adapter deriving it from the signed-in user. | Add an authenticated server boundary that checks the relevant page access, resolves the employee mapping and supplies the trusted employee ID to the existing privileged RPCs. Reject caller-supplied verifier identity. |
| Accounting | Typed reconciliation tables exist. The Billing RPCs do not post payments or calculate settlement balances. | Leave reconciliation and payments outside the Billing implementation. |

The existing lifecycle supports draft cancellation. Cancelling an issued invoice would require separate rules for stock, dispatch and returns.

## Currently implemented database workflow

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

### Currently implemented return RPC

`erp_verify_billing_return(request_id, billing_id, employee_id, lines)` remains a service-role RPC and records and verifies the return atomically. Each return line refers to one original billing line. A return can contain both modes.

- Set lines accept `mode: "set"`, `billing_item_id`, `returned_units`, `unit_price` and optional `reason_id`. The RPC copies the original product and expands the frozen billed size rows. Component prices are null because the price is recorded per set.
- Piece lines accept `mode: "piece"`, `billing_item_id`, optional `reason_id` and a `pieces_by_size` array containing `billed_piece_id`, `pieces` and `price`. The original flat component format remains accepted for existing integrations.
- Verified child quantities restore stock. Set and piece returns share the original billed-component limit. The invoice lock serializes concurrent returns and a request ID can only be retried with the same employee and payload. PO allowance is unaffected.
- Existing return lines retain their IDs, reasons and timestamps. Their quantities and prices move to size rows, and their original verification state continues to determine their inventory effect.
