# ERP business formulas

This register describes the formulas in the repository and identifies rules still awaiting implementation or live verification. Use the linked code and database definitions to check units, eligibility, rounding and ownership before changing a calculation. Keep example inputs synthetic.

## Fabric

Source: [Fabric domain](fabric-poc/src/fabric/domain.js). The [legacy workbook](fabric-poc/src/workbook.js) also implements these calculations with record-ID lookups and ranges ending at row 200.

| Calculation | Rule |
| --- | --- |
| Yarn consumed and balance, kg | Sum linked knitting consumption for the yarn bill item. Subtract consumption from its billed yarn quantity. |
| Greige balance, kg | Group by knitting bill and fabric name. Sum knitting billed quantities, then subtract gross quantities from linked dyeing lines. |
| Dyeing wastage, % | 100 × (gross quantity − billed quantity) ÷ gross quantity. Display to two decimal places. A zero gross quantity yields no wastage or derived price. |
| Derived dyed-fabric price per kg | (Yarn billed rate + knitting billed rate + dyeing rate) × (1 + wastage as a fraction). The portal rounds to two decimals after calculation. |

## Raw material inventory

Sources: [transaction RPCs](supabase/migrations/20261108150000_raw_material_transactions.sql) and [inventory domain](fabric-poc/src/inventory/domain.js).

- Available on a receipt = receipt billed quantity − sum of issues on that receipt. When editing an issue, exclude its existing quantity before checking the replacement. A reconciliation that closes the receipt must account for the remaining quantity.
- Total receipts allocated to a dyed-fabric batch must stay within its final quantity. Keep calculations within the material's stock unit.

## Production

Sources: [cut allocation](fabric-poc/src/production/item-model.js) and [Task Board projection](fabric-poc/src/production-task-board/live.js).

- Allocate the size's cut pieces across variant links. For each link, calculate size pieces × link weight ÷ total weight, then take the floor. Distribute remaining pieces in descending fractional-remainder order, breaking ties by original link order. Allocations sum to the size's input pieces.
- Live Task Board stage progress displays the zero-based stage index ÷ (stage count − 1) × 100, rounded to a whole percent. With one or fewer stages the stage-based calculation is zero. This indicator measures stage position.

## Finished Goods, billing and returns

Sources: [billing alignment](supabase/migrations/20261108110000_align_billing_er.sql) and [return composition and current warehouse calculations](supabase/migrations/20261108130000_return_bill_composition.sql).

| Calculation | Rule |
| --- | --- |
| Available physical pieces by size | Produced pieces + signed stock corrections − finalized/dispatched billed pieces − draft-held pieces + verified returned pieces. |
| Sellable variation capacity | Take the minimum across recipe components of floor(available physical pieces ÷ component share weight). A missing component balance contributes zero. |
| Produced sets for a variation | Take the minimum across recipe components of floor(produced physical pieces ÷ component share weight). |
| Billed component pieces | Billed sets × component share weight. Piece-level billing and returns preserve the size-level composition. |
| Returned sets | For each billing item within a verified return event, calculate the minimum across recipe components of floor(returned component pieces ÷ component share weight). Sum complete sets across events. |
| Stock valuation, preview rule | Physical pieces in house × item base price per piece. The [preview](fabric-poc/public/finished-goods-preview.html) labels this rule. Live quantity and price sourcing still need verification. |

## Item costing

Sources: [live-matched costing views and guards](supabase/migrations/20261108140000_item_costing.sql), [finished output receipt](supabase/migrations/20261107132756_finished_products.sql), and [costing source audit](docs/item-costing-audit.md). Update this section and the applicable verification cases when an approved rule changes.

| Rule | Formula and source | Verification case |
| --- | --- | --- |
| Job reference, legacy live view pending replacement | Per `variant_item_per_job.id`, sum linked `stage_pieces.pieces_stock_out` over sizes and multiply by `per_piece_billed_price`. Missing quantity or rate yields an unknown amount. Final billing basis is pending. | 10 and 15 pieces at 4 per piece yield 100. A missing rate yields null. Multiple bill lines must leave the stage quantity at 25. |
| Rejected quantity, agreed arithmetic | Comparable final-stage output minus accepted `item_produced_pieces.pieces`, aggregated at matching item, scope and size. Source-field selection, multipart conversion and valuation are pending. | 100 output and 94 accepted yield 6. A difference of −2 surfaces a reconciliation exception. |
| Approved manufacturing cost | Sum approved `item_costing_item.approved_amount` for a single version across Fabric, Trims & Accessories, Production and Peripherals. Live summary defaults the empty sum to zero. Store line amounts and derive totals. | 120 + 30 + 70 + 20 = 240. Another version, reference amounts and profit percentage contribute nothing to this approved sum. |
| Approved cost per completed unit | Approved total divided by positive `item_costing.completed_units`. Live summary yields null for a missing or zero denominator. The mapping from accepted physical pieces to completed units is pending. | 240 ÷ 12 = 20. Zero or missing completed units yields null. |
| Profit percentage | Operator-entered costing metadata. Pricing belongs to Sellable Product. | Changing profit leaves the four sections, totals and unit cost identical. Persistence remains pending. |

Keep ERP reference and approved values independent. Material rate and net consumption, overhead, final-stage selection and rejection valuation remain in the audit pending review. The cases above are expected results for future tests. This audit verified live view definitions and did not execute fixture-based tests.

### Approved costing rules for implementation

These rules describe the approved design. The existing live job-reference view still uses its legacy stock-out amount formula.

| Rule | Sources and calculation | Expected test |
| --- | --- | --- |
| Job paid amount | Sum `stage_pieces.pieces_stock_in` per `variant_item_per_job.id`, then multiply by `variant_item_per_job.per_piece_billed_price`. Effective rate per piece divides that amount by the same job-variant's summed stock-out. Zero or missing stock-out leaves the effective rate unknown. | 100 in, 96 out and ₹10 job rate yield ₹1,000 paid and ₹10.4166… per output piece. |
| Accepted costing units | For each size, take the minimum available part quantity from the current jobs whose stage has `stage_type = Complete`. Use their `pieces_stock_in`. Sum the size quantities across the item. | 23 tops and 22 bottoms in one size yield 22 accepted units. |
| Stage wastage | Cutting stock-out starts the piece trail. At subsequent tracked jobs, compare stock-in minus stock-out at matching job, variant and size. | 24 in and 22 out yield 2 pieces of wastage. |
| Approved piece-based amount | `item_costing_item.approved_quantity × approved_rate`. Quantity is total pieces and rate is currency per piece. Store the entered quantity and rate independently of the ERP reference. | 20 pieces at ₹55 yield ₹1,100. |
| Peripheral order and storage | Base is Fabrics + Trims and Accessories + Production + After production. Apply overhead, rejection, discount, then profit. Store the entered percentage in `item_costing_item.approved_rate`, interpreted through `item_costing_peripherals_type_id`; peripheral quantity may be null. Overhead, rejection and profit use gross-up, `amount ÷ (1 − percent / 100)`. Discount reduces the amount after rejection by multiplying it by `1 − discount / 100`. Profit uses that discounted amount. | 5% overhead on ₹100 yields ₹105.263157… before rounding. ₹100 after rejection with a 5% discount gives a ₹95 profit base. A 5% profit gross-up then gives ₹100. |

Implementation sources: [costing RPCs](supabase/migrations/20261109105000_item_costing_write.sql) and [stage configuration](supabase/migrations/20261109101000_seed_production_stages.sql). Variant-linked material issues use issued stock units multiplied by the receipt rate per stock unit. The reference piece count is accepted Ready to Dispatch units. Draft reference amounts follow edits to the linked checkout, and finalization captures the reference amount and per-piece rate. Approved amounts remain independent. SQL uses numeric precision through the calculation. The UI formats currency to two decimal places. The [production regression](database/tests/finished-products.sql) covers the limiting part and draft-to-production gate.
