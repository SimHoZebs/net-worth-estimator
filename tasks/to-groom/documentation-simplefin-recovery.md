# SimpleFIN documentation: correct recovery paths and cleanup

The recovery recipe lists account links through a per-account GET path that does not exist and instructs operators to run only two purge deletions. The complete purge also clears identity and freshness state. Current docs also confuse the `sync-pending-` namespace with legacy `sfin-pending-`.

Use collection `GET /v1/sync/simplefin/accounts` for listing and the complete versioned purge script for cleanup. Correct namespace, configured manual-wait, and Bridge retry-wait descriptions. Remove obsolete environment-based mapping claims. The SQL file owns the purge procedure, and the technical overview owns current sync behavior.

- Recipe/routes: `TESTING.md:310`, `backend/internal/api/server.go:193-197`.
- Namespaces: `backend/internal/store/sync.go:25-39`, `TECHNICAL_OVERVIEW.md:216-222`, `TECHNICAL_OVERVIEW.md` §§3, 11.
- Purge procedure/test: `backend/scripts/purge-simplefin-sync.sql:11-18,28-37`, `backend/internal/store/purge_test.go:35-73`.
- Current behavior: `backend/internal/simplefin/runner.go:161-182,246-280`, `TECHNICAL_OVERVIEW.md:136-143,480`.

Verify collection paths, namespace constants, all four active purge deletions, freshness cleanup, and retry headers. Change SQL comments, not executable statements. Runtime recovery checks require a disposable database.
