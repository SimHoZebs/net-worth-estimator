---
id: 091
title: Correct the schedule start and anti-duplication description
scope: doc-audit-reference
status: accepted
---

The analyses guide says a generated schedule always starts one full interval after the latest recorded movement so approval never duplicates bank facts. The code sets `StartDate` to `firstDay`, the oldest movement, while `Upcoming` advances from `lastDay`. The source comment states the real mechanism: creation claims each recorded movement onto its occurrence, and `Upcoming` lists six dates after the latest movement.

Rewrite the sentence to say the schedule starts on the oldest movement, each recorded movement is claimed at creation, and `Upcoming` lists six dates after the latest.

Verify that `StartDate` binds `firstDay` rather than an advanced `lastDay` and that the claim path runs in `CreatePatternSchedule`.

References: `docs/analyses.md:243-245`; `backend/internal/analysis/pattern_to_new_rule.go:183-187,227-228,264,269-274`; `backend/internal/analysis/pattern_to_new_rule_test.go:122`.
