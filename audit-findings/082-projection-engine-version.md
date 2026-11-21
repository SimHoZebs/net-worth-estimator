---
id: 082
title: Remove the single-value projection engine version check
scope: backend-domain
status: needs-review
---

A schema column defaulting to `v1`, mirrored by a Go constant, is checked on every projection read and can reinitialize state, bump revision, and set `dirty_from` on mismatch. No v2 exists or is proposed. Commit `d82ce5b1` removed the dead recurrence pipeline and duplicate engine while leaving `unifiedEngineVersion` untouched, so this is machinery for invalidating a cache on a value that never changes. SimpleFIN's protocol 2 migration is active and must stay.

Remove the read and build guard and its reinitialize branch, keeping the schema column for rollback compatibility until the next schema migration. Do not add a version enum while one implementation exists. This is deletion of framework residue; SimpleFIN v2 is an extension in flight and is untouched.

Verify that no `EngineVersion` assignments remain, run projection builder and store tests, and run `deploy/migrations.test.mjs`. The external roadmap was not searched and the historical `dirty_from` bump may have served a one-time upgrade that was not inspected.

References: `backend/internal/api/projections/builder.go:23,98-103`; `backend/internal/store/adapters/sqlite/projection_unified.go:44-46,63-86`; `backend/internal/types/projection_unified.go:31,199`; `docs/unified-projection.md:20`.
