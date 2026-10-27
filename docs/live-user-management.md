# Live user management

The standalone `/access.html` page uses the official pinned Supabase JavaScript client, phone/password sign-in, session refresh/sign-out, and protected RPCs. Local public configuration is in ignored `.env.local`; no service key is in the browser. Main Fabric/Inventory/Miscellaneous screens remain a sample-data workspace, with a separate local role preview. The Live sign-in link opens the actual access panel. This separation is explicit until real account activation and business-data APIs are complete; existing local preview controls are not authentication.

## Applied database changes

- `20261027173551_create_user_management_structure`
- Registered the screen/table catalogue (DML; see database/catalogue).
- `20261027175105_add_protected_user_management_commands`

The command migration adds current-user permission evaluation, an active resource/ancestor check, protected admin snapshots, role saves, account linking/enabling and server-side audit events. RPC entrypoints in public are security invokers calling private guarded functions. Authenticated callers get execution on those named commands, not SELECT/INSERT/UPDATE/DELETE on the access tables. Unknown/inactive users are denied. Custom roles cannot grant Administration. Administrator role edits are blocked. Account changes serialize with role changes, check record versions and cannot remove the last active Administrator. Updates run transactionally. Tests exercised these paths with uncommitted fixtures and rolled back all test users, roles, contacts, employees and grants.

The live panel offers a per-screen permission matrix, account-to-employee linking, multi-role assignment and audit review. Read-only resources may not have meaningful write actions; backend business command policies and operation capabilities will be refined before business activation. No shared business table grants were added. Basic role assignment functions do not create passwords/Auth accounts; an existing Auth identity is required.

## Administrator activation

The explicitly authorised employee code SCE/00001 and a protected Administrator role have been created. The employee display name is temporarily Administrator and can be edited in the real HR workflow. The owner subsequently added the exact verified recovery-email Auth account. It was linked to SCE/00001 and the protected Administrator role by an operator-authorised transaction, with an audit event. A current-identity database check confirmed enabled=true and administrator=true. That Auth identity has no phone attached yet, so the login page includes Administrator email/password sign-in for initial setup. The user enters their own password; no password was read, changed or supplied by the agent. Never select an unrelated account or use first-caller signup to grant Administration. Passwords and OTPs must be entered by the user, never provided to this chat.

Employee-code normalisation accepts exactly five digits, preserving leading zeroes and storing SCE/XXXXX. A local ten-digit Indian phone is normalised to +91; other international numbers need their country code.

## Recovery and OTP decision

The user specified that a recovery code is emailed to the Administrator, who passes the employee-specific code to the employee. The employee must choose a new password after verification. This is a custom scoped recovery challenge, never the Administrator's Auth login OTP/session. An email sender has not been configured; this flow is not implemented/activated. The page states recovery unavailable instead of pretending to send a code. Required next implementation: server-only challenge generation/digest, target binding, expiry, limited attempts/rate limits, single use, protected Auth password update and server audit; then email delivery integration.

The user subsequently asked about SMS OTP. Supabase supports passwordless phone OTP and phone MFA, but both need an SMS provider. The user selected password followed by SMS OTP (MFA). No SMS provider is configured, so MFA is not yet enabled or represented as active. Phone/password login remains available for accounts with a phone attached; Administrator email/password login permits initial setup.

## Remaining integration

The intended admin identity is now linked; next the user must sign in with their own credentials. Then exercise live role/account edits with that account, implement reviewed business RLS/transactional saves and restricted lookup projections, and connect the main workspace to live session permissions/data. The current live management UI has build/static/unit validation, but authenticated end-to-end tests remain blocked on that initial account.

## Role membership and archiving

Roles now provide Manage employees with Assigned/Add employees tabs, name/code search, visible names and codes, current roles/login state and confirmation before each change. The general account directory is search-first rather than a long list. Live role membership preserves other roles; users must hold another role before removing their last one. The browser-local preview still uses one role per employee and explicitly labels removal as Move to Viewer. Membership changes preserve login-enabled state.

Custom roles can be archived only after every assignment has been removed, including assignments to disabled accounts. Administrator cannot be archived. Archive updates role active state and appends an audit event rather than deleting history. Archived roles are hidden from assignment choices, with Show archived roles for review. Migration 20261027181252 implements the guarded server command with a shared mutation lock and expected-version check. Rollback-only database tests verified assigned-role rejection, protected Administrator rejection, stale-version rejection and successful archive/audit of an unassigned test role. Test fixtures were rolled back.

Employee picker refinement: Add employees now uses a library-backed, searchable single selection. Names are prominent, with employee codes beneath each option. Choosing a person shows only that employee for the existing review/confirm flow. The duplicate Find an employee section was removed from the local Roles page. Assigned members retain their own list search. No bulk/multiple selection is offered. Browser checks verified opening the selector, filtering by name and Enter selection without saving an assignment.
