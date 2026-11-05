# Fabric batch references and dyed-bill verification

Prepared locally on 5 November 2026; not applied to the live database.

- Live `dyeing_program_item.batch_no` is a nullable FK to `batch_no_lab_dip_version_map.id`. The selector now stores that ID and resolves the readable batch number throughout editing, review and reports. Output batch text still belongs to the mapping, one mapping per dyed receipt line.
- Lab Dip and program-line searches show colour, brand, dyer, exact edition/version and the latest child review status/date. No review fields are moved back onto the version table.
- Every dyed-bill create/edit save, including unchanged saves, requires a selected eligible active verified employee with an enabled account and the relevant Dyed Bills permission, plus their password. The operator keeps their existing MFA session.
- An isolated nonpersistent Auth client signs in the selected employee and obtains a 90-second, single-use proof bound to the operator and exact document payload. SQL rechecks eligibility/session and saves header, lines, mappings and verifier atomically. Passwords never enter the document RPC or browser persistence. The isolated session is signed out after success or failure.
- The generic Fabric save rejects dyed bills. Only `erp_save_verified_dyed_bill` can reach the restricted core for them. Other Fabric document commands retain the existing transaction and stale-record checks.

Migration: `20261105161411_verify_dyed_bills_and_batch_references.sql`. No batch FK change is needed. The release allowlist and postconditions include this migration; release only through the reviewed main-branch GitHub Actions workflow, after approval.

Local review: `http://127.0.0.1:8766/fabric.html#programs` and `#dyeBills`. Sample mode accepts a non-empty demo password and clearly labels this behavior. Live password authentication still requires acceptance testing after the migration is released; local SQL tests simulate Auth claims only in the disposable database.

Checks: Fabric unit/browser regression tests; `check:coherence`; full frontend quality; `database/tests/dyed-bill-verification.sql` for verified create/edit, bypass denial, fresh password, exact payload, proof replay/expiry, stale records and rollback. The CI database runner includes that SQL contract.
