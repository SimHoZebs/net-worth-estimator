---
id: 127
title: Document the current projection engine version
scope: doc-audit-reference
status: needs-review
---

The projection guide says the engine starts at `v1`. The runtime uses `v2` and checks saved engine versions so older results can be rebuilt. That behavior also invalidates the premise of finding [082](082-projection-engine-version.md).

Update the projection guide to describe `v2` as the runtime version and explain when saved results are rebuilt. Distinguish the runtime value from the SQLite column's default.

## References

- `docs/unified-projection.md:16-23` states the outdated default.
- `backend/internal/api/projections/builder.go:23,91-110` uses `v2` and handles a version mismatch.
- `backend/internal/api/projections/builder_engine_version_test.go:10-40` covers invalidation.
- `backend/internal/store/adapters/sqlite/schema.go:512` declares the column default.

## Verification

Source and test inspection confirms the `v1` to `v2` transition is handled by the version check.

Verify the guide against the type defaults, builder and version-bump test. Search current documentation for other assertions that only `v1` exists.
