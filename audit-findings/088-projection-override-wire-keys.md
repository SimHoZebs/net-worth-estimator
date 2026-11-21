---
id: 088
title: Correct the override keys in the projection example
scope: doc-audit-reference
status: accepted
---

The deterministic projection example documents `overrides.addedRules` and `overrides.disabledRuleIds`, but the Go wire tags are `addedSchedules` and `disabledScheduleIds`. A client copying the example sends fields Go silently drops, so the override does nothing while looking canonical. `TECHNICAL_OVERVIEW.md` section 2 already owns this shape and defers to the OpenAPI snapshot.

Replace both keys in the example. Keep section 2 as the sole owner of the shape.

Verify by reading `ModelOverrides` and the generated contract; both must agree on the two correct keys. Huma's problem-JSON behavior for unknown fields was inferred, not exercised by a request.

References: `TECHNICAL_OVERVIEW.md:150,153`; `backend/internal/types/model.go:350,353`; `backend/internal/domain/evaluation_whatif.go:14-15`; `frontend/src/api/generated/model/modelOverrides.ts:15,21`.
