# Cached results: qualify rename invariance

Renaming `Reach $1,000,000 net worth` inside the model changes completed-result identity because the full model enters that identity. Only the separate settings description strips evaluation names and disabled configurations. The overview incorrectly applies that property to the entire request.

Qualify the claim to the settings description. Replace the repeated version literal with `<kind>:<artifactCacheVersion>:<digest>`. Changing identity construction itself is a separate cache/result-label compatibility decision.

- Claims: `TECHNICAL_OVERVIEW.md:234-249`.
- Full-model inputs: `backend/internal/api/projection_handlers.go:64-71`, `backend/internal/api/stochastic_sse.go:273-282`.
- Settings/version: `backend/internal/api/artifacts.go:24-40,104-138`.

Compare every identity input, not only the settings helper. Distinguish model renames from settings renames in any new test. Cache hit rates and latency remain unmeasured.
