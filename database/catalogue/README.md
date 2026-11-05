# Screen and table catalogue

Configuration registered in Supabase project `kidvckaicclqvtlddeyz` on 27 October 2026, after the user approved this step. Registration at that checkpoint: 7 sections, 47 operational screens, 65 relations, 369 screen/relation mappings. The Miscellaneous screens were registered alongside their parallel local implementation. Empty future module headings are not registered as working screens. Fabric overview continues to derive its contents from authorised child resources, rather than getting a blanket read path to all data.

`screen-table-map.json` is the reviewable catalogue; `register-screen-table-mappings.sql` is the generated transactional, repeatable configuration seed. IDs are resolved by stable keys and schema/table pairs, never hardcoded generated IDs. The seed checks all relations exist before inserting metadata. `build-access-catalogue.mjs` regenerates these files from UI page metadata plus explicit reviewed table dependencies. Run from the repository root:

```
node database/build-access-catalogue.mjs
node database/test-access-catalogue.mjs
```

The registration was historically verified to be repeatable and did not change business rows or grant permissions. For future production catalogue changes follow the [reviewed release path](../../docs/deployment-ci.md). Use the checked-in catalogue and migrations for current scope.

Mapping flags are operation ceilings, not grants. Guarded commands evaluate permissions separately. See [authentication and security](../../docs/authentication-security.md). A command can map a screen action onto several database operations: editing an existing bill may insert new child lines, and changing account permissions may insert a role assignment. Check the actor's screen action and the mapping's physical operation ceiling within the same authorised path; do not assume SQL INSERT always means screen Create.

Lookup metadata does not grant SELECT on every column of a table. Implement restricted lookup projections for employee/contact fields before enabling access. Contacts deliberately has no bank-account-table lookup just for counts; bank details require their own screen permission. Tables registered as views (such as view_knitted_fabric_name) require reviewed view security when live reads are enabled. Audit-log writes occur inside protected commands; its screen is read-only. Formatting storage is not mapped because its shared-storage design is not created yet.

New screens need a reviewed entry in the generator. Changed or removed dependencies need explicit reconciliation; ordinary upserts intentionally do not delete unrelated catalogue entries.

Navigation revision: Yarn types and Fabric types now belong to Fabric; Brands belongs to Production. Reference data was removed from the registered section hierarchy, preserving all screen keys and table mappings.

Production first-increment resources are registered with write ceilings only for their primary/detail records, and read-only source/lookup dependencies. This is metadata; no employee role grants or business policies were enabled.

Production MVP adds local Task Board, Update Tasks, Flags and Gender catalogue entries. The board/operator routes share the existing `productionJobs` permission in the preview; Job history is read-only while that permission remains the underlying Production command boundary. Catalogue entries do not enable live adapters or grant role access. Regeneration also preserves the already-reviewed Employee reference-maintenance ownership.
