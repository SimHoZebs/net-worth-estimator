---
id: 032
title: Use the shared class-merger import in Toast
scope: contracts-types
status: implemented
---

Toast imports cn directly while the application utility explicitly owns the import boundary for primitives. Both resolve to the same implementation today.

Point Toast at the shared utility. This is one-line consistency hygiene with no LOC reduction or behavior improvement claimed. Do not introduce another merging helper.

## References

- `frontend/src/components/ui/toast.tsx:3` imports from cn.
- `frontend/src/lib/utils.ts:1-8` defines the single import owner.

## Verification

Import aligned with the shared owner; typecheck, lint, build, and notification tests pass in local cleanup checks recorded in README.

Search for direct merger imports outside the owner, then run lint/typecheck and current notification tests. Notification lifetime and actions stay unchanged.
