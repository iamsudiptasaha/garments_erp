# Fabric sub-parts and requirement status

The 22 November 2026 diagram is a reference; the approved task governs differences. Production parts and variant identities remain unchanged. Fabric sub-parts are `item_part_fabric` rows, each with an independent optional lab dip and fractional kg/piece. They never create Production or jobs. Existing requirement IDs and M:N links survive migration; no historical sub-part types or names are invented.

`item_part_fabric.item_part_fabric_status_id` stores only a manual override: On hold or Reused in-house fabric. NULL selects automatic status. `fabric_plan_estimates` is the single authoritative effective-status calculation, in precedence order: manual override, positive verified dyed receipt evidence on a linked program line, any link to a Final program, Not ordered. Quantity coverage never determines status. Clearing the override immediately uses current evidence. Reuse causes no stock validation or movement.

New dyeing programs default to Draft. Only Final programs contribute ordered estimate supply. Historical programs with recorded dyed-bill lines become Final; programs without evidence retain NULL and display Unclassified. The migration reports their count, and operators must explicitly classify them. It does not infer that an unreceived historical order is Draft. Verified receipt calculations and the approved yarn/knitting/dyeing price formula are unchanged.

Actual consumed kg is aggregated once per Variant + Fabric Type. It is never distributed across sub-parts. Existing colour reports and stock batch provenance remain available. Each sub-part retains its own planned kg and virtual coverage estimate.

## Function audit

| Action | Existing function/view | Change and justification |
| --- | --- | --- |
| Reuse | `fabric_plan_coverage(boolean)`, `fabric_plan_dyeing_surplus` | Existing virtual coverage prevents double-counting; no persisted allocations. |
| Reuse | `set_fabric_plan_dyeing_link`, public link RPC | Same M:N link write boundary, permissions and composite key. |
| Reuse | Verified bill save, attestation, receipt synchronization and costing functions | Existing receipt verification, one automatic receipt per dyed line, approved formula and stock protections remain authoritative. |
| Modify | `check_fabric_plan_dyeing_links()` | Compare component lab dip and exact fabric type. Retain the existing lock and constraints on requirements, program lines, links and lab versions. Retire its parent-variant trigger because component dips are independent. |
| Modify | `fabric_plan_requirements` | Keep equal planned-piece distribution and add component fields. Remove duplicated actual consumption from individual requirements. |
| Modify | `fabric_plan_dyeing_quantities` | Final supply counts as ordered; verified final physical kg remains received supply. |
| Modify | `fabric_plan_estimates` | Central effective-status projection with manual precedence, independent of coverage. |
| Modify | `fabric_planner_snapshot` | Individual requirements, source revisions, reference choices, program status and Variant + Fabric Type actual consumption in the existing guarded read. |
| Modify | `save_fabric_requirement`, public RPC | Replace variant/fabric identity with stable requirement ID and an optimistic full source revision. Supports multiple identical fabric types without ambiguous writes. |
| Modify | `production_setup_contract`, `production_row_owned`, `production_workspace` | Item-owned component rows use the existing atomic item save, ownership/reparent checks and reference projections. |
| Modify | `fabric_contract`, `fabric_snapshot` | Program status uses the existing document save and read permissions. |
| Retire | Old four-argument numeric-consumption requirement RPC signature | Its variant/fabric addressing becomes ambiguous once duplicate fabric types are allowed. Replaced in the same migration and client change. |
| New | None | No new database function, status-maintenance trigger, service layer, ordering flag, allocation table or inventory operation is needed. |

The shared `FabricRequirementFields` frontend component prevents duplicate component-input implementations in Items and Planner. Both retain Review → Confirm Save. Permissions and optimistic database checks remain on the server.
