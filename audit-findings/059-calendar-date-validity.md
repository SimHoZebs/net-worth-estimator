---
id: 059
title: Use one calendar date validity check
scope: contracts-types
status: rejected
---

The frontend decides whether a `YYYY-MM-DD` value is a real calendar day in two places. `calendarDayMs` round-trips the parsed UTC date and rejects a day that `Date` silently rolls into the next month; its comment records the reason. `isIsoDate` only applies a regex and a `NaN` check, so `isIsoDate("2024-02-30")` returns true even though `utcDate` turns it into March 1. The loose check is the one used on external evaluation dates and as a recurrence gate, which is exactly where an impossible day changes which occurrences a rule produces.

Make `isIsoDate` delegate to `calendarDayMs` and delete the regex-plus-`NaN` implementation, leaving one calendar date validity owner in the frontend. `utcDate` stays responsible for parsing and display.

Verify that `isIsoDate` rejects `2024-02-30`, `2025-02-29`, and `2026-04-31` while still accepting `2024-02-29`. The recurrence and financial-independence suites must keep producing the same occurrences for real dates.

References: `frontend/src/domain/format.ts:45-54`; `frontend/src/domain/calendarDay.ts:1-21`; `frontend/src/api/financialIndependence.ts:25-26`; `frontend/src/domain/recurrence.ts:401`; `frontend/src/components/editors/RecurrenceFields.tsx:64,137`.

## Decision

Rejected. Strengthening the check changes validation behavior, and deleting it changes behavior too, because unparseable strings would start passing and the rule editor would stop flagging a bad start date. Neither satisfies the rule that only behavior-neutral changes are made here, so existing behavior stays. If date validity ever needs a real guard, it should come from a native or library mechanism rather than another custom implementation.
