---
id: 020
title: Delete the unused error notice and duplicate field error
scope: contracts-types
status: implemented
---

The old ErrorNotice module has no consumers. It exports a second FieldError contract while live forms use the canonical shadcn field module.

Delete the unused module instead of migrating/restyling it. Existing size is 60 lines. Keep live Alert and canonical FieldError compositions. Correct stale error-feedback documentation separately under 029.

## References

- `frontend/src/components/ErrorNotice.tsx:1-60` defines the dead controls.
- `frontend/src/components/ui/field.tsx:179-227` defines the live error composition.

## Verification

Deletion verified by import searches and local cleanup checks recorded in README.

Search the entire repository for imports and path references. Run typecheck/lint and verify live canonical error callers. No runtime behavior should change.
