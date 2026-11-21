---
id: 090
title: Remove the false biweekly schedule limitation
scope: doc-audit-reference
status: accepted
---

The analyses guide says biweekly patterns stay non-actionable because no biweekly schedule exists yet. `recurringCadenceRecurrence` maps biweekly to a creatable `Recurrence{Week, Interval: 2}` and daily to a creatable daily rule; only unknown cadences receive the non-creatable reason. A regression already asserts that a biweekly preview is creatable.

Delete the limitation and state that daily, weekly, biweekly, monthly, quarterly, and annual patterns are creatable while only unknown cadences get the reason. The guided-model-setup guide lists the same gap but pins itself to a Komodo revision, so frame it rather than deleting it if that snapshot is intentional.

Verify by running the biweekly preview test and grepping `docs/` and `frontend/src` for `no biweekly` after the edit.

References: `docs/analyses.md:227-230`; `backend/internal/analysis/pattern_to_new_rule.go:40-43,44-63,255`; `backend/internal/analysis/pattern_to_new_rule_test.go:108-128`; `frontend/src/domain/recurringPatterns.test.ts:96`; `docs/guided-model-setup.md:24,28-30`.
