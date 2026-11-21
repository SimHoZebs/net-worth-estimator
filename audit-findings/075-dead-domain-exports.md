---
id: 075
title: Delete unreferenced domain exports and the unused prop
scope: frontend-domain
status: accepted
---

Two helpers retain API surface for behavior no render path uses. `nextProjectedPayments` picks the earliest projected payment per rule and has no caller or test; its caller was removed when Safe Spending moved to a cash-backed budget and payday values now come from `forecastPaydays`. `resolveTransactionAmounts` summarizes projected amounts for a "Varies" fallback, but its only caller is its own test. `TransactionsPanel` still accepts a `resolvedAmounts` map for this figure, yet its only render site in `AccountSections` never passes it, so calculated rows already show "Varies". Five more exports are referenced only at their definition: `daysBetweenInclusive`, `isArchivedAccount`, `fundingGapCaption`, `ALL_MOVEMENTS`, and `templateById`.

Delete `nextProjectedPayment.ts` and `resolvedTransactionAmounts.ts` with their tests. Remove the `resolvedAmounts` prop, its type import, `selectedResolved`, and the `resolved` argument from `TransactionsPanel`, making `TransactionAmount` always take the no-resolved branch. Delete the five unreferenced exports and their unused imports, dropping the `dateLabel` or `money` import in `fundingGaps.ts` only if the caption was their sole use there. Keep the `resolved` parameter on `scheduleTransaction`, which `ScheduleHistory.tsx` still passes inline.

Verify with typecheck, the unit suite, a repo-wide grep for each name, and the account browser regression. Rendered amount text for calculated rows must remain "Varies", which is current behavior. The resolved-amount helper's comment describes a real product need, so check whether a caller is intended to be re-wired rather than deleted.

References: `frontend/src/domain/nextProjectedPayment.ts:1-41`; `frontend/src/domain/resolvedTransactionAmounts.ts:1-48`; `frontend/src/pages/accounts/TransactionsPanel.tsx:21,28,36,59-61,145,162,176-214`; `frontend/src/pages/accounts/AccountSections.tsx:352-358`; `frontend/src/domain/format.ts:61-65`; `frontend/src/domain/model.ts:32-34`; `frontend/src/domain/fundingGaps.ts:297-300`; `frontend/src/domain/flowDiagram.ts:18`; `frontend/src/domain/amountCatalog.ts:265-267`.
