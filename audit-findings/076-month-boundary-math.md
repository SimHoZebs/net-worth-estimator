---
id: 076
title: Leave one owner for month-boundary math
scope: frontend-domain
status: accepted
---

`clampMonth` in `format.ts` is the shared clamped-month owner behind `horizonDate`. `firstOfMonth` and `lastOfMonth` in `flowWindow.ts` recompute the same month-end formula with their own UTC math, so leap-year and month-end correctness is maintained in two live files and `flowWindow.test.ts` pins its own copy only. The exports `firstDayOfMonthIso` and `lastDayOfMonthIso` are used solely by that test. The third owner, `addMonthsClamped`, is removed by finding 074 and `monthEndIso` goes with the same dead layer.

Make `firstOfMonth` and `lastOfMonth` call `clampMonth` with day 1 and day 31, leaving `clampMonth` as the sole owner, and delete the two test-only wrappers and their cases. No new helper is created.

Verify that the existing leap assertions for `2024-02-29` and `2023-02-28` pass unchanged. `clampMonth` takes a zero-based month and anchors at 12:00 UTC, so confirm `flowWindow`'s `getUTCMonth()` basis before swapping. No savings were measured.

References: `frontend/src/domain/format.ts:67-80`; `frontend/src/domain/flowWindow.ts:15-37`; `frontend/src/domain/result.ts:121-147`; `frontend/src/domain/flowWindow.test.ts:12-20`.
