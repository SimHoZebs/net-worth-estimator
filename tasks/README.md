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
