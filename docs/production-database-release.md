# Employee and contacts production database release

This workflow is deliberately manual, main-only, and scoped to exactly:

- `20261031191218_employee_hr_workspace.sql`: employee save/read/reference commands, employee verification proof table and invalidation trigger, employee-code generator, Contacts lookup-only permissions from HR. It does not edit employee business records or create Auth accounts.
- `20261031201306_contact_primary_selections.sql`: three default-false, non-null primary flags and three partial unique indexes. Existing Contacts remain non-primary.

## Required setup

Add `PRODUCTION_DATABASE_URL` as a secret in the GitHub **production environment**, not a frontend variable or repository file. Use the Supabase Connect dialog's Postgres direct connection or **session pooler** (port 5432). The workflow accepts only project `kidvckaicclqvtlddeyz`, database postgres, and the postgres owner account. It rejects transaction-pooler port 6543 and other projects. Percent-encode reserved password characters. TLS certificate verification is enforced regardless of URL SSL options. Do not send the connection string in chat.

Keep the production environment restricted to main and configure its required reviewer. Check a recent real production backup and its recovery procedure before dispatch; the checkbox is an operator attestation, not proof from the synthetic CI restore. No production data dumps are uploaded to Actions artifacts or logs.

## Run and verify

1. Review and merge the workflow, script and fixed migrations through dev to main.
2. Open **Approved employee and contacts database release** in GitHub Actions. Choose main, enter its full reviewed commit SHA, confirm the project reference, and attest to the checked backup.
3. The workflow reruns all CI checks, including the isolated database tests. It cannot migrate on a failed or skipped check. Approve the protected production job when requested.
4. The runner verifies main has not advanced and applies only the fixed release files in one database transaction under an advisory lock. Migration history is written in the same transaction. A failure rolls back both migrations. A rerun skips only exactly matching recorded SQL; changed history aborts.
5. Schema, uniqueness indexes, verification-table RLS and anonymous denial are verified before commit. Actions summary records commit and migration hashes only. Confirm the successful run, then perform read-only production verification of the columns/functions before claiming completion.

This does not deploy Edge Functions, alter Auth configuration or automatically migrate other files. The existing main application deployment remains separate. After a successful migration, use a forward fix for later issues; do not automatically drop columns, proof records or migration history. A database restore requires its own reviewed recovery operation.

## Explicit owner decision on 1 November 2026

The owner authorised proceeding without a verified backup, deferring a paid backup plan. The workflow retains the backup-confirmed input as false and records `OWNER APPROVED WITHOUT VERIFIED BACKUP` in its separate exception input. This exception applies only to these two fixed migrations; it does not waive CI, branch, commit, project, TLS or production-environment protections. Actions records the decision in the successful migration summary. No backup is represented as restore-verified.
