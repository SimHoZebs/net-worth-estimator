---
id: 029
title: Document the current error feedback owners
scope: doc-audit-reference
status: implemented
---

The guide describes unused ErrorNotice/duplicate FieldError as current owners and cites removed tests. Following it would recreate a retired wrapper instead of using live shadcn Alert/FieldError.

Rewrite references around canonical primitives and current local error/retry behavior. Remove coverage claims for deleted ErrorNotice.test.tsx, errorLayout.spec.ts, and retired receipt/transaction browser checks. Keep single-channel feedback and failed-edit retry rules.

## References

- `docs/error-feedback.md:9-27` names obsolete owners/tests.
- `frontend/src/components/ErrorNotice.tsx:8-60` is unused; deletion is finding 020.
- `frontend/src/components/ui/field.tsx:179-227` owns live FieldError.
- `TESTING.md:79-99` defines regression-only UI policy.

## Verification

Guide updated to live Alert/FieldError owners and checked against source; obsolete component/test references removed.

Verify named owners/tests exist. Search for removed-module/test references after updating. This does not request restoring the broad UI suite or changing its policy.
