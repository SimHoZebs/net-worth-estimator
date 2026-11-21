---
id: 074
title: Delete the Safe Spending forecast layer left by the server takeover
scope: frontend-domain
status: accepted
---

`safeSpending.ts` states the current rule: every amount comes from the server summary and only windows stay on the client. Several pre-takeover windowed sums and forecasts survived with no production caller. `mandatoryTransactions`, `monthEndIso`, `nextMonthRange`, and `DEFAULT_CYCLE_STATEMENT_DAY` appear only in their own tests, and all of `safeSpendingMath.ts` is dead once those go. `expectedMonthlyIncome` re-expands schedules for a calendar month, which is the figure the server now returns as `expectedPay` from `forecastPaydays`. It is the sole production consumer of `scheduleExpansion.ts`, a thin wrapper over `recurrenceOccurrenceDates`, which is itself a client copy of backend recurrence expansion. `recurrenceOccurrenceDates`, `addMonthsClamped`, `monthlyNthWeekdayDate`, and private `daysInMonth` have no caller outside that chain and its tests. `safeSpendingHistory.ts` and `recurringBillIncreases.ts` are also test-only, and the latter is the last consumer of `groupByDate`. A stale grooming inventory still describes callers that no longer exist.

Delete the listed functions and constants from `safeSpending.ts`, delete `safeSpendingMath.ts`, `safeSpendingHistory.ts`, `recurringBillIncreases.ts`, `scheduleExpansion.ts`, and the `expectedMonthlyIncome` export from `safeSpendingIncome.ts`, and delete the four recurrence expansion functions and their tests from `recurrence.ts`. The replacing owners are `SafeSpendingSummary`, backend `forecastPaydays`, and live `scheduleHistoryTransactions` for recorded-evidence rows. Keep every selection helper and the live `paymentCapacity.ts` window logic, which the server-ownership comment explicitly reserves to the client.

Verify that a repo-wide grep for each symbol returns nothing outside historical docs, that typecheck and the unit suite pass with no component import changed, and that the live selection hook and Safe Spending Outlook views still resolve cards, bills, and income. Deadness is from static call graphs at this checkout, not runtime observation.

References: `frontend/src/domain/safeSpending.ts:14-15,17,20-41,75-146`; `frontend/src/domain/safeSpendingMath.ts:1-84`; `frontend/src/domain/safeSpendingIncome.ts:40-79`; `frontend/src/domain/safeSpendingHistory.ts:1-47`; `frontend/src/domain/recurringBillIncreases.ts:1-20`; `frontend/src/domain/scheduleExpansion.ts:1-45`; `frontend/src/domain/recurrence.ts:338-351,358-380,390-475`; `backend/internal/safespending/payday_income.go:69-107`; `tasks/to-groom/long-chaining/frontend-monthly-obligations.md:8,12`.
