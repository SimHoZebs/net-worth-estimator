---
id: 022
title: Remove the unused direct date-fns dependency
scope: deploy-build-test
status: implemented
---

The frontend declares date-fns but has no application/config/script import. Date helpers use Date/Intl; the calendar uses react-day-picker.

Remove the direct dependency and regenerate the lockfile normally. This is dependency hygiene, not proof that every transitive copy disappears or the bundle shrinks.

## References

- `frontend/package.json:37` declares date-fns.
- `frontend/src/domain/format.ts:1-80` owns current helpers.
- `frontend/src/components/ui/calendar.tsx:1` uses the calendar library.

## Verification

Removal verified by import searches, install consistency, and local cleanup checks recorded in README. A transitive dependency remains; no bundle saving is claimed.

Search all workspaces, including styles/config. Verify install consistency, typecheck, and build. Check transitive requirements before claiming package-size savings.
