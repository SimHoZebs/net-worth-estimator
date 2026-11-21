---
id: 100
title: Keep the backup command in one owner
scope: doc-audit-reference
status: accepted
---

The `sqlite3 .backup` and integrity-check snippets appear in the shared-database guide and the deploy README, while the migration SOP owns the backup contract. Three copies of a safety-critical command drift easily, especially when one changes the file path or verification step.

Keep the pointer at `docs/shared-database.md:91` and drop both code blocks, or turn the deploy README copy into a link to the SOP.

Verify that a `.backup` search across `docs/` and `deploy/` shows one owning snippet plus pointers.

References: `docs/shared-database.md:89-118,99,110`; `deploy/README.md:67-77,72`; `deploy/MIGRATIONS.md:110,124-125`.
