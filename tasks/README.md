# Task backlog

History and grooming notes in this directory are non-normative. The current
contracts live in `TECHNICAL_OVERVIEW.md`, `TESTING.md`, `PRODUCT_INTENT.md`,
`docs/`, `deploy/MIGRATIONS.md`, and `deploy/README.md`.

Do not bulk-delete user backlog here. Stale compatibility goals were corrected
narrowly:

- Model imports support the current document shape only; no legacy file shape
  is supported. See `to-groom/model-import-boundary.md` and the server-owned
  validation in `TECHNICAL_OVERVIEW.md`.
- Backend static frontend serving is removed; the split container deployment
  is current. See `to-groom/documentation-static-serving.md`,
  `TECHNICAL_OVERVIEW.md` system and container boundary, and
  `deploy/README.md`.

Deployment target status and migration lifecycle follow the shared SOP
checklist in `deploy/MIGRATIONS.md`. Do not invent SHAs or declare
conversions complete from a single host.

## Notion backlog import (2026-11-01)

Consolidated index: `NWE_BACKLOG.md` (35 Notion records, all Backlog at
export, plus export-only proposed `PERF-01.md`). Individual work packages
are the `<ID>.md` files in this directory. Read
`../docs/group-sharing-decisions.md` and
`../docs/architecture-validation.md` before building group-sharing or
caching work. Task descriptions are a dated planning snapshot, not live
Notion sync; check current repository and Notion state as implementation
proceeds. Respect `Depends on` relationships and open-issue labels. Do not
start deferred source-transaction edits, a custom event broker, or an
unbenchmarked invalidation rewrite.

- Foundation: `FND-01.md`, `FND-02.md`, `FND-03.md`, `FND-04.md`, `FND-05.md`
- Branding: `BRD-01.md`, `BRD-02.md`
- Integrations: `INT-01.md`, `INT-02.md`, `INT-03.md`, `INT-04.md`
- Recurring & financial health: `FIN-01.md`, `FIN-02.md`, `FIN-03.md`,
  `FIN-04.md`, `FIN-05.md`
- Money-flow visualization: `VIS-01.md`, `VIS-02.md`, `VIS-03.md`
- Friends & shared expenses: `SOC-01.md`, `SOC-02.md`, `SOC-03.md`,
  `SOC-04A.md`, `SOC-04B.md`, `SOC-04C.md`, `SOC-05.md`
- Groups & sharing: `GRP-00.md`, `GRP-01.md`, `GRP-02.md`, `GRP-03.md`,
  `GRP-04.md`, `GRP-05.md`
- Quality & delivery: `QA-01.md`, `QA-02.md`, `QA-03.md`
- Architecture validation (proposed, not in Notion): `PERF-01.md`
