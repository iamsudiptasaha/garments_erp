# Portal foundation

## Current implementation

The pilot uses React 18 and Vite with JavaScript modules. The Fabric workspace is implemented in `fabric-poc/src/fabric/`; its schema-shaped local model and shared document form preserve parent/child identities. See `fabric-data-map.md` for its live-database mapping and deferred integration. `fabric-poc/src/model.js` owns sample records and validations; each library comparison adapts those records to its renderer. FortuneSheet is the active candidate, not an irreversible platform choice. Moving to TypeScript is a planned implementation decision; this repository does not claim the existing prototype is TypeScript.

## Application structure

Keep the expandable Fabric section and its pages beneath it. The other module headings follow Fabric: Raw Material Inventory, Production, Billing, After Sales, Miscellaneous and Employee. The comparison pages currently use static navigation. Introduce a shared navigation registry when the production shell consumes it; do not retain unused scaffolding.

Business data is edited through explicit Add/Edit forms with validation and confirmation. The sheet is a projection of records: formatting can change, values cannot be changed by typing, paste, delete, autofill or structural spreadsheet actions. Sorting must reorder complete records, never independent cells.

Separate these responsibilities as production code grows:

| Layer | Responsibility |
| --- | --- |
| Domain | Record identities, calculations and business validation |
| Data access | Reads and validated commands against the existing database |
| Presentation | Record-based colours/styles and user-specific view preferences |
| Grid adapter | Map records and presentation to a replaceable spreadsheet library |
| Forms | Add/Edit workflow with explicit Save/Cancel |

Formatting belongs to stable record ID + field key, not a visible row number. Saved column widths, freezing, filters and sort order can be per user. Shared formatting and personal view settings must not overwrite business records.

## Planned backend

Supabase Postgres, Auth and Storage are the intended backend. No live client, credentials, login flow or new schema is installed by this foundation. The `.env.example` and environment parser describe the future browser configuration only.

Before exposing existing tables, review grants and RLS against actual employee permissions. Frontend protection is usability, not authorization. Enforce writes and stock checks at the server/database boundary, include audit attribution, and reject stale updates rather than silently overwriting another user's changes.

The team has approximately 10–15 users with infrequent overlap. Start with safe saves; shared cursors and presence can follow. Phone-based individual authentication is proposed because employees do not have their own emails. Employee IDs remain stable when phone numbers change. SMS setup and shared-phone handling remain undecided.

## Fabric rules already agreed

- Yarn count + fabric type derives the knitted fabric name, such as `30S Sinker`.
- `gross_quantity` means greige knitted fabric consumed.
- Trace yarn → knitted fabric → dyed fabric by linked source records and batches.
- Balance reports group by knitting bill + fabric name; multiple names use comma-separated values inside a cell.
- Build Fabric first and validate it before expanding the same UI pattern to the other modules; TNA comes last.

## Open implementation decisions

Production data mapping and transaction boundaries must be confirmed against the actual schema; do not infer writes from the sample model. Still to complete: live authentication, role policies, server validation, persistent formatting tables, hosting and backups/recovery checks. No deployment is configured yet.
