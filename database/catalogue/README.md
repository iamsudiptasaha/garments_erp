# Screen and table catalogue

Configuration registered in Supabase project `kidvckaicclqvtlddeyz` on 27 October 2026, after the user approved this step. Current registration: 7 sections, 47 operational screens, 65 relations, 369 screen/relation mappings. The Miscellaneous screens were registered alongside their parallel local implementation. Empty future module headings are not registered as working screens. Fabric overview continues to derive its contents from authorised child resources, rather than getting a blanket read path to all data.

`screen-table-map.json` is the reviewable catalogue; `register-screen-table-mappings.sql` is the generated transactional, repeatable configuration seed. IDs are resolved by stable keys and schema/table pairs, never hardcoded generated IDs. The seed checks all relations exist before inserting metadata. `build-access-catalogue.mjs` regenerates these files from UI page metadata plus explicit reviewed table dependencies. Run from the repository root:

```
node database/build-access-catalogue.mjs
node database/test-access-catalogue.mjs
```

The seed was executed using Supabase execute_sql as DML. No tables/policies/grants were added in this step, no business rows were touched, and no roles, users or role permissions were assigned. Repeat execution was verified without duplicate catalogue records. After execution: 0 lookup/report write mappings, 0 unprotected Administration children, 0 user assignments, 0 role grants. All 8 access tables remain RLS-enabled and inaccessible directly to anon/authenticated.

Mapping flags are operation ceilings, not grants. Permission evaluation, protected commands and business RLS remain the next step. A command can map a screen action onto several database operations: editing an existing bill may insert new child lines, and changing account permissions may insert a role assignment. Check the actor's screen action and the mapping's physical operation ceiling within the same authorised path; do not assume SQL INSERT always means screen Create.

Lookup metadata does not grant SELECT on every column of a table. Implement restricted lookup projections for employee/contact fields before enabling access. Contacts deliberately has no bank-account-table lookup just for counts; bank details require their own screen permission. Tables registered as views (such as view_knitted_fabric_name) require reviewed view security when live reads are enabled. Audit-log writes occur inside protected commands; its screen is read-only. Formatting storage is not mapped because its shared-storage design is not created yet.

New screens need a reviewed entry in the generator. Changed or removed dependencies need explicit reconciliation; ordinary upserts intentionally do not delete unrelated catalogue entries.

Navigation revision: Yarn types and Fabric types now belong to Fabric; Brands belongs to Production. Reference data was removed from the registered section hierarchy, preserving all screen keys and table mappings.

Production first-increment resources are registered with write ceilings only for their primary/detail records, and read-only source/lookup dependencies. This is metadata; no employee role grants or business policies were enabled.
