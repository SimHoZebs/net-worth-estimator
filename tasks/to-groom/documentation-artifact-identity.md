# Stored results: qualify rename invariance

Status: addressed. The overview distinguishes settings-only omissions from complete-model identity inputs and uses the versioned result identity format. The original finding follows.

Renaming `Reach $1,000,000 net worth` inside the model changes completed-result identity because the full model enters that identity. Only the separate settings description strips evaluation names and disabled configurations. The overview incorrectly applies that property to the entire request.

Qualify the claim to the settings description. Use `<kind>:<artifactIdentityVersion>:<digest>` for the versioned identity format. Changing identity construction itself is a separate stored-result/result-label compatibility decision.

- Claims: `TECHNICAL_OVERVIEW.md:234-249`.
- Full-model inputs: `backend/internal/api/projection_handlers.go:64-71`, `backend/internal/api/stochastic_sse.go:273-282`.
- Settings/version: `backend/internal/api/artifacts.go:24-40,104-138`.

Compare every identity input, not only the settings helper. Distinguish model renames from settings renames in any new test. Result retrieval rates and latency remain unmeasured.
