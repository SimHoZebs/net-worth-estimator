---
id: 094
title: Remove the orphaned authorization migration checklist
scope: doc-audit-reference
status: accepted
---

The authorization guide ends a sentence with a colon that introduces no list, then says no import path remains and that owner assignment is a one-time data migration rather than signup role selection. Code records `member` or `viewer` on first verified access, and the migration SOP contains no owner-assignment migration. A nearby line also claims a migration preserves existing behavior.

Delete the dangling lead-in and the import-path sentence, replace the owner-assignment sentence with the current first-access rule plus a pointer to the Casbin section, and reword the preservation line into a durable statement about roles staying beside the data.

Verify that a migration grep in the guide returns only the SOP link and that no code path performs one-time owner assignment.

References: `docs/authorization.md:51,137-148`; `backend/internal/authorization/client.go:119-135`; `backend/internal/authorization/setup.go:55-61`; `deploy/MIGRATIONS.md`.
