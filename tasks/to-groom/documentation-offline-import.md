# Offline import: remove the retired income option

The audited README passes `-income ../public/data/income`, but the importer accepts only `-db` and `-model`. The published command stops at flag parsing before importing anything.

Remove that option, the obsolete income-file tree, and income-snapshot persistence claims. Remove `NET_WORTH_ESTIMATOR_INCOME_PATH` from `.env.example`. Add the existing account-balance evaluation CSV to the model tree. README owns the executable import recipe.

- Examples: `README.md:20-36`, `.env.example:5`, `frontend/RUNNING.md:75`.
- Actual interface/files: `backend/cmd/importcsv/main.go:12-25`, `backend/internal/csvio/import.go:19-29`.

Compare every documented option and file with the CLI/importer. Preserve the backup warning because replacement import is destructive. Any execution check requires a disposable database. This also covers the deployment audit's duplicate finding.
