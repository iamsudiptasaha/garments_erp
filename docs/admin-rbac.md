# Administration and RBAC foundation

## Current local implementation

Employee / HR is the home for the employee directory and profile creation/editing: name, stable employee code and phone. Administration contains Roles & permissions (including account-role assignment and login-access enable/disable) and Activity log. It is visible and routable only to an active Administrator account, independently of custom role grants. New employees require a country-code phone number; duplicate phone numbers and employee IDs are rejected. HR-created profiles start with a Viewer role and disabled account access. HR profile updates preserve role and account-access state; attempts to change either through the HR command are rejected. Role assignment and account access are separate administrator commands. A phone-profile edit does not automatically change a verified Supabase Auth phone identity. Editing a phone does not change the stable internal identity.

Roles control View, Create, Edit, Format, Export and Print per page, with unavailable actions omitted for read-only reports. No permission is allowed unless View is present. Missing roles, unknown resources/actions and disabled employees deny access by default. The built-in Administrator role cannot be edited; removing the last active access administrator is rejected. State revision checks reject stale updates. Only authorised preview actors can execute role/employee mutations; custom roles cannot receive Administration permissions, and the Administrator designation is assigned only through the account-permissions control; changes create audit entries.

The application uses the shared permission check for routes, document actions, form commits, formatting and provided export/print controls. Permissions are evaluated when saving as well as when rendering buttons. The always-visible "Preview as" selector exists solely to test the design; it is not an authentication session. Browser storage and this activity log are editable by the browser owner and are not a security boundary or tamper-proof audit record. Export/print permissions govern application controls; they cannot prevent a reader taking screenshots, copying visible values or using browser features.

Administrator, Accounts, Production and Viewer are starter templates, not approved assignments to real employees. Preview accounts have no linked phone or Auth user. Adding an employee here does not create a Supabase Auth identity, set credentials or send an SMS. Never store passwords in this preview or business tables.

## Database inspection and proposed structure

Read-only inspection found no existing role/profile/permission tables in public or garments_erp. `database/drafts/admin-rbac.sql` is an additive, unexecuted SQL review draft defining private roles, permission catalogue/grants, employee-to-Auth memberships and audit events. Memberships refer to the real `garments_erp.employee.id` and `auth.users.id`; the preview's sample directory is not a migration of real employees. The draft explicitly revokes direct browser access and enables RLS. Its private helper uses `auth.uid()` and current membership records, not user-editable metadata.

No live database grant, role assignment, auth configuration or legacy business policy has been changed. Applying the draft alone would not make the application secure. There is deliberately no zero-check first-admin signup, automatic privilege grant to the first caller, service-role browser key or direct client update to role tables.

## Live activation work

1. Identify the actual employee and verified Auth user who will be the first administrator. Provision/login must use Supabase Auth; the user enters their credentials themselves.
2. Confirm the permission templates and map the database's business tables/lookup views to those resources. Existing anonymous grants and missing RLS must be addressed as a deliberate rollout, not mistaken for enforced RBAC.
3. Create controlled admin save APIs with current actor checks, expected versions, transaction-wide locking of access changes, last-admin checks and server-written audits. Revoke direct permission-table writes. Test impersonation/self-escalation, disabled users, stale saves and concurrent last-admin changes.
4. Apply/test business RLS and atomic bill/program save APIs; protect shared formatting by Format permissions and personal view preferences by user identity. Lookup access must expose only the fields needed by allowed forms, not all contact/employee data.
5. Verify policies as anonymous, Viewer, Accounts, Production and Administrator before connecting the live app. Client UI guards remain usability checks alongside server enforcement.

## Multi-value cells

Greige report dyers (and yarn-balance knitters) now have a display-value array separate from the underlying comma-separated business projection. The sheet renders one name per line in the same cell, enables native wrapping and expands row height. Print and CSV use that display representation. The record relationships and names are not edited to add line breaks.

Sheet zoom uses FortuneSheet's native `zoomRatio` (50%, 75%, 100%, 125%, 150%, 200%). It persists with page layout in this browser and remains available to read-only preview users. It scales only the sheet display, not stored quantities, font-size formatting or the application shell. In the live implementation it belongs to personal view preferences. Multi-value names are separated by comma + newline, with no trailing comma on the last name.

Access preview schema version 2 migrates the former adminUsers permission to employees under HR, removes stale delegated Administration grants, and preserves employee identities, roles and audit history. Old #adminUsers links resolve to the HR directory. The unexecuted SQL draft includes an explicit administrator system key for enforcing the same hard Administration boundary.
