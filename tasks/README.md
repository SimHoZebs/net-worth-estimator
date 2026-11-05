# Task backlog

History and grooming notes in this directory are non-normative. The current
contracts live in `TECHNICAL_OVERVIEW.md`, `TESTING.md`, `PRODUCT_INTENT.md`,
`docs/`, `deploy/MIGRATIONS.md`, and `deploy/README.md`.

Do not bulk-delete open backlog here. Completed work packages were removed on
2026-11-05. Stale compatibility goals were corrected narrowly:

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

Consolidated index: `NWE_BACKLOG.md` (open records after removing completed
work packages, plus export-only proposed `PERF-01.md`). Individual work packages
are the `<ID>.md` files in this directory. Read
`../docs/group-sharing-decisions.md` and
`../docs/architecture-validation.md` before building group-sharing or
caching work. Task descriptions are a dated planning snapshot, not live
Notion sync; check current repository and Notion state as implementation
proceeds. Respect `Depends on` relationships and open-issue labels. Do not
start deferred source-transaction edits, a custom event broker, or an
unbenchmarked invalidation rewrite.

- Branding: `BRD-01.md`, `BRD-02.md`
- Integrations: `INT-02.md`, `INT-04.md`
- Recurring & financial health: `FIN-04.md`
- Friends & shared expenses: `SOC-03.md`, `SOC-04C.md`
- Groups & sharing: `GRP-01.md`
- Quality & delivery: `QA-02.md`
- Architecture validation (proposed, not in Notion): `PERF-01.md`
