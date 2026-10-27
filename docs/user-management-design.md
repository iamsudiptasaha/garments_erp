# User management · step 1 review

`database/applied/20261027173551_create_user_management_structure.sql` was applied to Supabase project `kidvckaicclqvtlddeyz` as migration `20261027173551`. It supersedes the earlier `admin-rbac.sql` draft. Do not rerun either former draft. This step creates the private configuration tables only: no live client grants, Auth changes, role assignments or business-table policy changes.

| Table | Responsibility |
| --- | --- |
| app_role | Role catalogue; one designated system Administrator role |
| app_resource | Section/screen hierarchy and routes; admin-only marker |
| app_role_resource_permission | Role × screen permissions, including presentation/export/print |
| app_db_table | Registered schema/table pairs |
| app_resource_table | Screen × table mapping with read/create/edit/delete operation ceilings |
| app_user | Stable Auth-user ↔ HR-employee link, with independent login-access switch |
| app_user_role | Role assignments, assigner and assignment timestamp |
| app_activity_log | Structured event storage, actor and time |

All IDs are bigint identities except Auth user IDs (uuid). Employee references use the existing bigint employee ID. Permission flags default to false and cannot be null. Role/resource pairs, resource/table pairs and user/role pairs are unique. Write/format/export/print grants require View. Lookup and report-source mappings cannot permit writes. The private schema tables have RLS enabled and no client grants or policies in this draft.

## Enforcement contract for subsequent steps

- Active app user, active role and active resource are required; unknown/missing entries deny access.
- A table operation must match an authorised screen and that screen's table-operation ceiling. For a lookup read, an authorised viewer of the screen can read the approved lookup projection. For a table write, the same role/screen path must grant the requested action. Permissions must not be combined from unrelated paths to manufacture write access.
- The model permits multiple roles per user. Proposed rule: additive grants across valid paths, with no explicit-deny flags. The first UI can still assign one role. This choice must be retained explicitly when building the evaluator.
- Administration requires the designated system Administrator role regardless of other screen permissions. Mark Administration and every protected child as admin-only; server validation must reject hierarchy changes that weaken this boundary. Parent cycles, section/screen consistency and inactive ancestor behaviour need validation in the resource-management API.
- Role assignment/access changes use protected transactional APIs with version checks, an explicit active-actor/admin check, concurrency-safe last-admin protection and server-written audits. Users cannot write these tables directly.
- Table mappings are metadata, not dynamic SQL or automatic grants. Seed reviewed mappings from known application tables. The future policy/helper code implements these rules; business RLS/save APIs still need implementation and tests.
- Format covers shared presentation records; it does not permit editing business values. Export/Print govern app controls and cannot prevent copying already visible information.
- Activity logging must be written by controlled server operations. This schema alone does not install triggers or make an audit trail tamper-proof against database owners.

## Review boundaries

The migration executed successfully in Supabase after confirming no access-schema object collisions and checking the UUID Auth / bigint employee FK types. Post-apply inspection confirmed all eight tables exist, RLS is enabled on each, and neither anon nor authenticated has SELECT/INSERT/UPDATE/DELETE privileges. Supabase migration history confirms version 20261027173551. The security advisor reports “RLS enabled, no policy” for these tables, intentionally: this step is default-deny storage, with policy/helper activation to follow. See https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy . Existing advisory findings elsewhere in the project were not changed by this migration. No seeded Administrator exists; bootstrap requires an explicitly identified Auth user and real employee. No phone, password, OTP or credential is stored in these access tables.

## Step 2 · catalogue registered

Registered 7 sections, 35 screens and 326 mappings to 52 existing relations. Lookups/reports are read-only ceilings; all deletion flags remain false. Administration resources are explicitly admin-only. No user/role grants or business policies were changed. Source, repeatable seed and checks are in `database/catalogue/` and `database/test-access-catalogue.mjs`. Miscellaneous screen work and sidebar polish are separate local UI changes, not database enforcement.
