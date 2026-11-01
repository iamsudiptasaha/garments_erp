# Deployment policy

- Every deployment must run through GitHub Actions, including the portal, mailer, backend functions and production database migrations.
- Never deploy from a local CLI, apply production SQL directly, or use dashboard deployment controls. User approval does not waive this rule.
- Never spoof CI environment variables, bypass failed checks, remove required gates, or override branch/environment protections to complete a release.
- If the relevant deployment workflow is missing or broken, repair and review it through Git first. Commit work to `dev`; release via a reviewed merge into production (`main`).
- Report deployment status from the actual GitHub run. A successful commit, merge or CI check alone does not prove deployment succeeded.

# Database and UI coherence

- The database is the source of truth. Before implementing a screen, inspect its columns, foreign keys, related record ownership, constraints, generators and relevant functions.
- A foreign-key input must select the linked record. Do not turn it into a second editor for that record's children without explicit user approval. Employee contact links do not authorise editing contact people or bank accounts inside Employee.
- Contact details, bank accounts and their supporting documents belong to Contacts. Employee screens link employee and emergency contacts through the existing foreign keys.
- If an approved UI conflicts with the database, stop the affected implementation, explain the exact conflict and consult the user before proceeding. Do not silently change either the database or the UI to reconcile it.
- Coherence checks must cover relationships and ownership, not only matching table and column names. Passing syntactic checks does not establish workflow correctness.
- Run `npm --prefix fabric-poc run check:coherence` for every UI/backend change. Vite validates startup, builds and source/backend changes automatically; the staged pre-commit hook and CI enforce the same checks. Extend the reviewed ownership contract before adding a new custom screen or save boundary. A new business interpretation requires user consultation, not merely a new allowlist.
