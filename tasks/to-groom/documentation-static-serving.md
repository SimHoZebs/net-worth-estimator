# Static-serving documentation: describe missing-page responses

With `NET_WORTH_ESTIMATOR_FRONTEND_PATH` set, a missing path such as `/settings/profile` returns HTTP `404`, using `404.html` when available. The overview incorrectly promises an index fallback. The frontend uses fragment navigation such as `/#accounts`.

Replace the index-fallback claim with the implemented response. The technical overview owns backend static serving, while the frontend guide owns navigation.

- Claim/navigation: `TECHNICAL_OVERVIEW.md:30`, `frontend/RUNNING.md:52`.
- Handler/test: `backend/internal/api/server.go:84-101,124-141`, `backend/internal/api/model_handlers_test.go:853-883`.

Review existing-file, missing-page, API-route, traversal, and symlink tests. Align the separate [smoke correction](deployment-smoke-contract.md). A routing rewrite is not needed to correct the documentation.
