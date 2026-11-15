---
id: 019
title: Delete the unused detail row recipes
scope: contracts-types
status: implemented
---

DetailList, DetailRow, and four CVA recipes have no consumers. They preserve an unused custom appearance API.

Delete the whole module. No replacement is needed. Existing size is 35 lines, measured directly; rendered behavior does not change.

## References

- `frontend/src/components/DetailRow.tsx:1-35` contains all definitions and frontend usages of these names.

## Verification

Deletion verified by import searches and local cleanup checks recorded in README.

Repeat repository-wide path/symbol/dynamic-import searches. Run typecheck and lint after deletion. This audit checked source references, not runtime behavior.
