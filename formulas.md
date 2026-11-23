# ERP business formulas

This register describes the formulas in the repository and identifies rules still awaiting implementation or live verification. Use the linked code and database definitions to check units, eligibility, rounding and ownership before changing a calculation. Keep example inputs synthetic.

## Fabric

Source: [Fabric domain](fabric-poc/src/fabric/domain.js). The [legacy workbook](fabric-poc/src/workbook.js) also implements these calculations with record-ID lookups and ranges ending at row 200.

| Calculation | Rule |
| --- | --- |
| Yarn consumed and balance, kg | Sum linked knitting consumption for the yarn bill item. Subtract consumption from its billed yarn quantity. |
| Greige balance, kg | Group by knitting bill and fabric name. Sum knitting billed quantities, then subtract gross quantities from linked dyeing lines. |
| Dyeing wastage, % | 100 × (gross quantity − billed quantity) ÷ gross quantity. Display to two decimal places. A zero gross quantity yields no wastage or derived price. |
| Derived dyed-fabric price per kg | (Yarn billed rate + knitting billed rate + dyeing rate) × (1 + wastage as a fraction). Round to two decimal places after calculation in the portal and in `garments_erp.dyed_fabric_receipt_price`. The verified bill writes the result to `raw_material_check_in.billed_price` (₹/kg). Its receipt uses the dyed line’s final physical kg for `raw_material_check_in.billed_quantity`. |

### Fabric Planner estimates

- Adding planner links to a dyeing-program item retains its complete existing link set and sums the authoritative `fabric_plan_requirements.required_kg` once per linked requirement ID. Recalculation rounds only at the program quantity's existing three-decimal kg storage boundary. The reviewed total is checked again in the atomic save; a subsequent entered ordered-kg override remains independent. Removing links does not recalculate quantity. No coverage, receipt or costing formula changes. [Atomic save](supabase/migrations/20261123200917_lab_dip_edition_groups.sql) · [Document staging](fabric-poc/src/fabric/program-model.js)

- Planner colour subtotals and grand totals sum the SQL-supplied `fabric_plan_estimates.required_kg` once per `item_part_fabric.id`, separately for each `fabric_type_id`, within the current filtered requirement set. No rounding precedes aggregation; the existing kg display formats up to six decimal places. Overview and Sheet share this projection; neither recalculates planned pieces, consumption, coverage or costing. [Presentation projection](fabric-poc/src/fabric/planner-model.js)

- Required kg = planned variant pieces × consumption kg per piece. Each part uses the planned size totals of its root’s item. Distribute each size’s cut-ratio pieces equally across the variants configured on that part, giving remainder pieces to the first variant-item IDs. A dependent part can use its own variants and inherits its root’s Production ID.
- Ordered and received kg are virtual coverage of required kg across compatible linked dyeing program items. Use Final program quantity for ordered supply (Draft and unclassified programs contribute zero) and the final physical quantity of verified dyed lines for received supply. Cover requirements that can be filled in full before allocating partial coverage. Within each pass, evaluate smaller requirements first and use the least-shared supply first. Each supply quantity is counted at most once per estimate. Shortages and surpluses are the remaining demand and supply.
- Actual consumed kg is manual outward quantity on dyed inventory aggregated once per Variant + Fabric Type, excluding stock reconciliation. Never distribute it across fabric sub-parts. Component lab dips determine exact order compatibility; each sub-part retains its own fractional planned kg. Manual On hold / Reused in-house fabric overrides precede automatic Received (verified physical receipt evidence), Ordered (any link to a Final program), and Not ordered. Status never depends on estimated quantity coverage. The estimates create no inventory movement. [Planner SQL](supabase/migrations/20261117103000_fabric_planner_quantities.sql)

## Raw material inventory

Sources: [transaction RPCs](supabase/migrations/20261108150000_raw_material_transactions.sql) and [inventory domain](fabric-poc/src/inventory/domain.js).

- Available on a receipt = receipt billed quantity − sum of issues on that receipt. When editing an issue, exclude its existing quantity before checking the replacement. A reconciliation that closes the receipt must account for the remaining quantity.
- Total receipts allocated to a dyed-fabric batch must stay within its final quantity. Keep calculations within the material's stock unit.

## Production

Sources: [cut allocation](fabric-poc/src/production/item-model.js) and [Task Board projection](fabric-poc/src/production-task-board/live.js).

- Allocate the size's cut pieces across variant links. For each link, calculate size pieces × link weight ÷ total weight, then take the floor. Distribute remaining pieces in descending fractional-remainder order, breaking ties by original link order. Allocations sum to the size's input pieces.
- Live Task Board stage progress displays the zero-based stage index ÷ (stage count − 1) × 100, rounded to a whole percent. With one or fewer stages the stage-based calculation is zero. This indicator measures stage position.

## Finished Goods, billing and returns

Sources: [local Billing value and return checks](supabase/migrations/20261112044630_bind_billing_to_purchase_order.sql), [billing alignment](supabase/migrations/20261108110000_align_billing_er.sql), [return composition and current warehouse calculations](supabase/migrations/20261108130000_return_bill_composition.sql), and the [return editor projection](supabase/migrations/20261112052959_billing_carton_return_workspace.sql).

| Calculation | Rule |
| --- | --- |
| Available physical pieces by size | Produced pieces + signed stock corrections − finalized/dispatched billed pieces − draft-held pieces + verified returned pieces. |
| Sellable variation capacity | Take the minimum across recipe components of floor(available physical pieces ÷ component share weight). A missing component balance contributes zero. |
| Finished Goods summaries | Produced physical units per size use the limiting item part across current complete jobs. Open ordered sets are formal non-cancelled PO units less dispatched sets, floored at zero per line. Available percentage is available set capacity ÷ produced sets × 100, rounded to two decimals. Zero produced sets leaves the percentage unknown. [Summary RPC](supabase/migrations/20261109142922_finished_goods_catalogue.sql) |
| Produced sets for a variation | Take the minimum across recipe components of floor(produced physical pieces ÷ component share weight). |
| Ordered standard component pieces | Ordered sets × verified sellable-product component share weight for each size. PO entry preserves the recipe. |
| Billed component pieces | Billed sets × component share weight. Piece-level billing and returns preserve the size-level composition. |
| Returned sets | For each billing item within a verified return event, calculate the minimum across recipe components of floor(returned component pieces ÷ component share weight). Sum complete sets across events. This is a stock summary and does not determine credit eligibility or value. |
| Original billed value, local SQL | Sum billed sets × invoiced set price for standard lines, or billed pieces × invoiced size-row price for exception lines. Use the original invoice currency, before GST. |
| Suggested return price per physical piece, local SQL | Standard sale: original invoiced set price ÷ sum of the frozen billed component weights per set. A ₹300 set of two tops and one pant suggests ₹100 per piece. Exception sale: original invoiced price per piece on the billed size row. |
| Verified return value, local SQL | Sum returned whole physical pieces × operator-confirmed credit price per piece across verified returns, in the original invoice currency before GST. The confirmed price is nonnegative and capped at the original invoiced set price for standard components or the original invoiced piece price for exception pieces. Historical set-mode returns contribute their verified set count × stored confirmed set price. Cumulative verified credit cannot exceed original billed value, and verified quantities cannot exceed the original pieces billed on each size row. |
| Taxable value after verified returns, local SQL | Net billed value = original billed value − verified return value. The invoice-wide credit cap keeps taxable value nonnegative. |
| GST and GST-inclusive total, local SQL | GST amount = taxable value × stored invoice GST percentage ÷ 100. GST-inclusive total = taxable value + GST amount. Use existing numeric and display conventions without additional accounting-specific rounding rules. See the [Billing contract](database/billing-contract.md). |
| Stock valuation | In-house pieces × final unit cost from the newest finalized costing linked to the receipt. Physical quantity includes draft holds and finalized pieces awaiting dispatch. Missing linked costing leaves value unknown. The [valuation RPC](supabase/migrations/20261109140609_finished_goods_costing_valuation.sql) uses database numeric precision. |

The [invoice editor](fabric-poc/src/billing/invoice-editor.js) previews the unsaved amount from the entered sets or pieces, invoice prices and GST percentage. The display formats currency to two decimals. Saved invoice totals come from the database.

## Item costing

Sources: [live-matched costing views and guards](supabase/migrations/20261108140000_item_costing.sql), [finished output receipt](supabase/migrations/20261107132756_finished_products.sql), and [costing source audit](docs/item-costing-audit.md). Update this section and the applicable verification cases when an approved rule changes.

| Rule | Formula and source | Verification case |
| --- | --- | --- |
| Job reference view, pending release | Per job, sum non-null `job_worker_bill_items.billed_rate` across its challan lines and bills. For each job-variant, multiply that currency-per-piece rate by summed stage stock-out. Missing quantity or billed rate yields null. | 25 pieces and bill rates 4 and 6 yield 250. Challan rates contribute nothing. |
| Rejected quantity, agreed arithmetic | Comparable final-stage output minus accepted `item_produced_pieces.pieces`, aggregated at matching item, scope and size. Source-field selection, multipart conversion and valuation are pending. | 100 output and 94 accepted yield 6. A difference of −2 surfaces a reconciliation exception. |
| Approved manufacturing cost | Sum approved `item_costing_item.approved_amount` for a single version across Fabric, Trims & Accessories, Production and Peripherals. Live summary defaults the empty sum to zero. Store line amounts and derive totals. | 120 + 30 + 70 + 20 = 240. Another version, reference amounts and profit percentage contribute nothing to this approved sum. |
| Approved cost per completed unit | Approved total divided by positive `item_costing.completed_units`. Live summary yields null for a missing or zero denominator. The mapping from accepted physical pieces to completed units is pending. | 240 ÷ 12 = 20. Zero or missing completed units yields null. |
| Profit percentage | Operator-entered costing metadata. Pricing belongs to Sellable Product. | Changing profit leaves the four sections, totals and unit cost identical. Persistence remains pending. |

Keep ERP reference and approved values independent. Material rate and net consumption, overhead, final-stage selection and rejection valuation remain in the audit pending review. The cases above are expected results for future tests. This audit verified live view definitions and did not execute fixture-based tests.

### Approved costing rules for implementation

The billing source changes in the [challan migration](supabase/migrations/20261109191200_production_challan_alignment.sql). The view uses stock-out for its reference amount. Draft creation retains the stock-in basis for paid amount.

| Rule | Sources and calculation | Expected test |
| --- | --- | --- |
| Job paid amount | Sum `stage_pieces.pieces_stock_in` per `variant_item_per_job.id`, then multiply by the summed job bill rate above. Effective rate per piece divides that amount by the same job-variant's summed stock-out. Zero or missing stock-out leaves the effective rate unknown. | 100 in, 96 out and ₹10 job rate yield ₹1,000 paid and ₹10.4166… per output piece. |
| Accepted costing units | For each size, take the minimum available part quantity from the current jobs whose stage has `stage_type = Complete`. Use their `pieces_stock_in`. Sum the size quantities across the item. | 23 tops and 22 bottoms in one size yield 22 accepted units. |
| Stage wastage | Cutting stock-out starts the piece trail. At subsequent tracked jobs, compare stock-in minus stock-out at matching job, variant and size. | 24 in and 22 out yield 2 pieces of wastage. |
| Approved piece-based amount | `item_costing_item.approved_quantity × approved_rate`. Quantity is total pieces and rate is currency per piece. Store the entered quantity and rate independently of the ERP reference. | 20 pieces at ₹55 yield ₹1,100. |
| Peripheral order and storage | Base is Fabrics + Trims and Accessories + Production + After production. Apply overhead, rejection, discount, then profit. Store the entered percentage in `item_costing_item.approved_rate`, interpreted through `item_costing_peripherals_type_id`; peripheral quantity may be null. Overhead, rejection and profit use gross-up, `amount ÷ (1 − percent / 100)`. Discount reduces the amount after rejection by multiplying it by `1 − discount / 100`. Profit uses that discounted amount. | 5% overhead on ₹100 yields ₹105.263157… before rounding. ₹100 after rejection with a 5% discount gives a ₹95 profit base. A 5% profit gross-up then gives ₹100. |

Implementation sources: [costing RPCs](supabase/migrations/20261109105000_item_costing_write.sql) and [stage configuration](supabase/migrations/20261109101000_seed_production_stages.sql). Variant-linked material issues use issued stock units multiplied by the receipt rate per stock unit. The reference piece count is accepted Ready to Dispatch units. Draft reference amounts follow edits to the linked checkout, and finalization captures the reference amount and per-piece rate. Approved amounts remain independent. SQL uses numeric precision through the calculation. The UI formats currency to two decimal places. The [production regression](database/tests/finished-products.sql) covers the limiting part and draft-to-production gate.
