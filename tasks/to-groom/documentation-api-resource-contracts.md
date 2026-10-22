# API documentation: distinguish model entries, recipes, pins, and links

The overview describes one generic write contract, but these resources have different methods, validation, and responses. For example, pinned evaluations use GET/PUT and return `instanceIds`, not a saved-model identity.

Replace the generic overview with the actual contracts: model-entry saves return entry/issues/save status/identity, recipe saves omit identity, pins return IDs, and link saves return link/identity. Include recipe and pin routes in the authorization list. Correct retired whole-model PUT comments in `.env.example` and the obsolete `TestPutAuthMatrix` selector in `TESTING.md`.

- Claims: `TECHNICAL_OVERVIEW.md:48,151-154`, `.env.example:17-18`, `TESTING.md:88`.
- Actual contracts: `backend/internal/api/server.go:194-197`, `backend/internal/api/pinned.go:9-49`, `backend/internal/api/preset_handlers.go:28-36`, `backend/internal/api/account_link_handlers.go`.
- Guard/tests: `backend/internal/api/auth.go:33-36`, `backend/internal/api/auth_test.go:24`, `backend/internal/api/pinned_test.go:23-93`.

Cross-check methods, exact wire field names, responses, unknown-ID behavior, and guards against handlers and registration. Use the existing `TestRowWriteAuthMatrix` selector. This is a documentation correction, not a universal API-wrapper redesign.
