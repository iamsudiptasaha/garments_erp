# Database/UI coherence guard

Run `npm --prefix fabric-poc run check:coherence` from the repository root.

The guard is local and open source: no hosted service, API key or production writes. It runs at Vite startup/build and on UI, database-contract, migration and backend changes. A failure blocks hot updates and JavaScript requests with an error overlay until corrected. Pre-commit validates the staged tree; the normal CI quality gate runs the same checks before deployment.

Validation layers:

- Reviewed schema capture: table/column names, required links and attachment foreign keys.
- `database/contracts/ownership.json`: which records a screen owns versus selects, expected FK targets, permitted writable tables and explicit maintenance boundaries.
- Actual Employee form descriptors and backend SQL: identical writable field sets, no contact/bank grants or writes from Employee, including helper calls.
- Shared Fabric/Colours SQL contract compared with the actual frontend writable contract.
- Isolated database tests: permissions, rollback, stale/concurrent edits and rejection of nested contact writes.
- Browser tests: Employee selectors exist and duplicated name/bank inputs do not.

Regression tests intentionally introduce the original bank editor/permission mistakes, wrong FK targets and backend-only fields and assert rejection. Development-server tests assert that failures stop builds/HMR and prevent invalid modules loading.

Limits: this is deterministic contract validation, not an AI proof of business intent or an automatic production-schema refresh. The schema capture date is printed on each run; schema/migration changes need review and isolated replay. Generic catalogue screens use the existing declared form checks; the deeper ownership/save-function policy currently covers Employee and the shared Fabric/Colours writable contract. Register and review equivalent policies for new custom screens. Do not infer a business rule from a matching column name or silence failures by broadening permissions. Consult the user when an approved UI differs from the database.

Production and Inventory are explicitly marked unreviewed. Their source-file fingerprints block additions, deletions or edits until a genuine ownership contract is reviewed and registered. These fingerprints are a freeze, not an audit approval; refreshing them to silence a failure is prohibited. Existing untouched modules are not being represented as fully semantically audited.
