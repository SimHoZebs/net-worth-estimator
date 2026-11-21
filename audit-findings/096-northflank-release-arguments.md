---
id: 096
title: List all required Northflank release arguments
scope: doc-audit-reference
status: accepted
---

The Northflank guide lists exactly three release query arguments — `RELEASE_SHA`, `API_IMAGE`, and `IDENTITY_IMAGE` — in both the overview and the incident-recovery override procedure. `release.json` declares five: the identity service and database-addon IDs drive the pre-deploy dump and identity image deploy. An operator re-releasing a failed target from the UI or API submits an incomplete set and fails at the identity steps.

Add both IDs to each list, state that they are prepared Northflank IDs supplied automatically by the gated workflow and needed explicitly only for a manual run, and defer to `release.json` as the single owner rather than re-enumerating them.

Verify that each prose list matches `release.json:5` and that the two IDs appear in the guide and the migration doc after the edit.

References: `deploy/northflank/README.md:67-69,103-105`; `deploy/MIGRATIONS.md:174-175`; `deploy/northflank/release.json:5,23,73`; `.github/workflows/northflank-release.yml:152-153,163,176-177`.
