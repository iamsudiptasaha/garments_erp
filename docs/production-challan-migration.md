# Production challan alignment

The saved Fabric.drawio item page moves variant assignment, description and rate to the challan line and leaves item size and issued pieces on the child. The challan header has no type or worker FK. The worker filter uses the linked jobs. A job owns a single production part, so the mockup limits Part to that job’s part and Variant to its assigned variants.

| Record | Change |
| --- | --- |
| Challan | Keeps issue date, number and issuing employee. |
| Challan line | Required FK to the exact job-variant assignment replaces the direct job FK. Description and numeric rate are optional. |
| Size quantity | Keeps the line FK, item size FK and issued quantity. A deferred check compares each issued size to the stage stock-in. Quantities are whole pieces. Prior challans are outside the comparison, so a job variant can be issued again in full. |
| Worker bill item | The existing unique line FK prevents a line from appearing on a second bill, including under concurrent requests. A bill can include different lines from one or several challans. Billed rates stay independent of challan rates. |
| Item costing | The existing reference view and draft creation RPC now use the sum of billed rates across the job. Stage quantities aggregate independently. Existing saved costing amounts are retained. |

The read-only live audit found zero headers, lines, size rows, bill items and job-variant assignments. The migration preserves compatible legacy line IDs, quantities, rates and bill links. It aborts on conflicting or missing legacy mappings, populated obsolete miscellaneous records or populated legacy job-variant rates. These cases require reconciliation before release.

The [production document workspace](../fabric-poc/production-challan.html) loads Supabase data using the dedicated read and transactional write RPCs. Challans and Worker Bills have independent screen permissions. Existing non-administrator roles receive no new permissions automatically. Deletion is available to administrators under the current pilot role policy. The bill picker receives only the linked challan data required by billing and omits employee identities. The bill file uses the existing private upload route, which requires bill edit permission. Save and upload are separate operations, so an upload failure leaves the saved bill available for retry.

Existing issue snapshots stay intact on metadata edits. The RPC rejects a stale document revision, mixed workers, a changed or removed billed assignment, and attempts to bill a line already on another bill. Deleting a bill releases its lines for billing. Bills and challans have separate read, create, edit and delete operations.

Review both migrations through the database release workflow. The SQL fixture covers authenticated aggregate CRUD and authorization. The browser spec uses a signed local fixture session and real Supabase responses to verify concurrent requests and persistence.

The browser check takes the access token and public key for the disposable gateway at port 55431. Run it with `CHALLAN_TEST_TOKEN`, `CHALLAN_TEST_KEY` and `E2E_BASE_URL` set. For private-file coverage, serve the existing `erp-files` function and set `CHALLAN_TEST_FILES=1` and `CHALLAN_TEST_ACTOR` for a real local MFA session.
