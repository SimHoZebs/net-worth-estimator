---
id: 083
title: Record the posted-time repair script in the migration ledger
scope: backend-domain
status: needs-review
---

`repair-claimed-posted-time` fixes settled bank rows whose posted instant was zeroed by a pending refresh while claimed, and a live guard in `writeBankValues` now prevents recurrence. `MIGRATIONS.md` requires one-time scripts in its pending table and retires them only after every target verifies. This tool appears in no migration doc or `migrate.sh` step; it is reachable only through a README command an operator must find manually.

Add a pending-table row with the operator command and the postcondition of zero settled rows with non-positive posted time, and wire the binary into `deploy/migrate.sh` with the same fail-closed candidate-copy execution as other one-time tools. Do not delete the script until targets verify. This extends the ledger, not the runtime.

Verify by running the script's tests, executing the migration body in verify mode against a fixture with a zeroed claimed row, and confirming the candidate copy has zero violating rows while the original is byte-identical. No live database was inspected, so whether any target still holds corrupt rows is unknown.

References: `backend/scripts/one-time/repair-claimed-posted-time/main.go:1-3,44-131`; `backend/scripts/one-time/repair-claimed-posted-time/README.md:1-18`; `backend/internal/store/adapters/sqlite/sync_pending.go:259-268`; `deploy/MIGRATIONS.md`.
