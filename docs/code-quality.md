# Code quality and sanity checks

Run from `fabric-poc/` with Node 22.13 or newer on the Node 22 line:

```sh
npm ci
npm run quality
```

The same command is configured in `.github/workflows/verify.yml` for pushes and pull requests. It becomes active after these files are committed and pushed; no remote run is claimed yet. Branch protection is not configured, so the workflow alone does not prohibit merging a failing PR.

| Check | Purpose | Failure rule |
| --- | --- | --- |
| ESLint | Undefined variables, unused locals, unreachable code, common JavaScript mistakes, duplicate imports | Any error or warning |
| Knip | Unused files, dependencies and exports | Any reported issue |
| jscpd | Repeated JavaScript/CSS blocks in source and shared styles | More than 5% duplicated lines, for matches of at least 100 tokens |
| Node tests | Record identity, whole-row sorting, immutable data projection, stock validation, formulas, configuration safety | Any failing test |
| Vite build | Import/bundling and production-build sanity | Build failure |
| npm audit (CI) | Dependency advisories | High/critical fail; moderate/low remain visible |

ESLint uses its recommended bug rules with a small additional ruleset. Tests have browser and Node globals available because the prototype spans both environments. Knip explicitly knows the three comparison entry points and test files; it does not treat every source file as an entry to hide unused code. Duplication scanning includes `src` and `styles.css`. Generated reports, dependencies and build outputs are ignored. Current match settings found no duplicate blocks; this is not a claim that no smaller or semantic duplication exists.

The duplication HTML/JSON report is written to `fabric-poc/reports/duplication/` and uploaded as a private-repository workflow artifact for 14 days. No external analysis subscription, semantic-model download, source upload to an analysis vendor or auto-deletion of code is configured. npm audit queries npm with dependency metadata.

## Human review

Before merging, review whether code is needed by a current feature, reuses existing domain rules, preserves record identity through sorting, handles errors and unavailable storage, and keeps business authorization at the server boundary. Static tools cannot establish product usefulness or prove business correctness. Do not add placeholder abstractions or disable a failing rule merely to make the gate green; document narrow, justified exceptions.

## Current known issue

The FortuneSheet dependency chain reports uuid advisory GHSA-w5hq-g745-h8pq, shown by npm as three moderate entries through uuid, core and React. No automatic dependency fix is currently available. Review reachability and an upstream fix before production. No forced major-version override or blanket advisory suppression is installed.

## Initial verification

The complete gate passes with 15 tests. Separate temporary probes confirmed non-zero exits for an undefined variable, an unreachable unused file, and an intentionally duplicated source block. Probe files were removed. Initial cleanup removed unused exports and an unused navigation-registry placeholder, fixed local const declarations, and documented the browser-storage fallback catch.

## Database/UI coherence gate

The database is authoritative. `npm run check:coherence` compares declared form entities, input keys, detail keys, document foreign keys, checklist fields and screen/table catalogue references with `database/schema/live-schema.json`, captured read-only from Supabase. Missing names block the check. A UI label can differ from a database identifier; a stored field cannot silently do so. Composite forms and derived output columns need explicit adapter contracts before they can be certified.

`.githooks/pre-commit` runs the checker and domain tests on every normal local commit after installing with `git config core.hooksPath .githooks`. The hook exports the staged Git tree to a temporary folder, so unstaged changes cannot mask the committed version. Git hooks can be bypassed; the same gate is part of `npm run quality` in GitHub Actions. Repository branch protection is not configured.

A committed schema snapshot is not a live connection. Refresh it from the read-only query in `database/schema/capture.sql` after every approved database change, retaining the project ID and capture timestamp. No service key is stored in the repository. Remote changes made without refreshing this snapshot cannot be detected by an offline commit hook.

Workflow correctness also requires the domain regression tests and human review of changed source-to-destination mappings, nullability, units, quantities, defaults, role rules and status transitions. This gate is deliberately not described as an AI reviewer or proof that all dataflows are correct. Do not add blanket exceptions or baseline current mismatches just to pass it. Resolve discrepancies against the database or record an explicit reviewed adapter with a regression test.
