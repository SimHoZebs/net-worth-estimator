---
id: 043
title: Keep one layer per mirror case
scope: deploy-build-test
status: accepted
---

The same preview outcome is asserted at three layers with identical literals: biweekly unsupported, income monthly creating `2026-04-15` plus six upcoming, and rent-to-existing claiming three. Each layer has a distinct contract (math vs persistence plus review wiring vs HTTP status plus auth), but repeating every literal everywhere means a copy edit fails three files without catching a new regression.

Keep math cases once in `analysis`, persistence plus review once in `sqlite`, and status plus auth once in `integration`. Genuine wire contracts (404/422/409/403 mapping, `Cache-Control: private, no-store`) stay.

Verify with `go test ./backend/internal/analysis ./backend/internal/store/adapters/sqlite ./backend/internal/api/integration -run 'Pattern' -count=1`.

References: `backend/internal/analysis/pattern_to_new_rule_test.go:84-114`; `backend/internal/store/adapters/sqlite/analysis_pattern_to_new_rule_test.go:159-174`; `backend/internal/store/adapters/sqlite/analysis_pattern_payment_test.go:64-150`; `backend/internal/api/integration/analysis_pattern_to_new_rule_test.go:92-227`; `backend/internal/api/integration/analysis_pattern_payment_test.go:60-239`.
