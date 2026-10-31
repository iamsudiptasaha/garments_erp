# Deployment policy

- Every deployment must run through GitHub Actions, including the portal, mailer, backend functions and production database migrations.
- Never deploy from a local CLI, apply production SQL directly, or use dashboard deployment controls. User approval does not waive this rule.
- Never spoof CI environment variables, bypass failed checks, remove required gates, or override branch/environment protections to complete a release.
- If the relevant deployment workflow is missing or broken, repair and review it through Git first. Commit work to `dev`; release via a reviewed merge into production (`main`).
- Report deployment status from the actual GitHub run. A successful commit, merge or CI check alone does not prove deployment succeeded.
