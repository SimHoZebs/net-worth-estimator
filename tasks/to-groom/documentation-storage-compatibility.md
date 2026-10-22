# Database backups: describe the current-schema requirement

The audited storage docs promise migrations and version checks. The initializer only creates absent tables and leaves existing table shapes unchanged. An older backup can therefore lack columns required by current reads.

Correct `TECHNICAL_OVERVIEW.md` and assumption A3 to describe that compatibility limit. Correct A20 as well: the production server starts an empty database with an import notice, not an automatic CSV import. A migration implementation would be a separate decision.

- Claims: `TECHNICAL_OVERVIEW.md:183-189`, `docs/backend-migration/ASSUMPTIONS.md:9,35`.
- Implementation: `backend/internal/store/schema.go:10-63`, `backend/internal/store/model.go:402-405`, `backend/cmd/server/main.go:87-93`.

Compare the complete initializer with current migration/version/startup claims. Preserve assumption identifiers and historical decisions. The important risk is an operator expecting an old backup to upgrade automatically.
