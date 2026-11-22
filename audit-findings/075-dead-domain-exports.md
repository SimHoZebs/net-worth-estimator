---
id: 075
title: Delete unreferenced domain exports and the unused prop
scope: frontend-domain
status: accepted
---

## Scenario

Open the Accounts page and select one account. The page renders that account's section from `frontend/src/pages/accounts/AccountSections.tsx`, which mounts the transaction table in `frontend/src/pages/accounts/TransactionsPanel.tsx`. On load the browser sends the account-detail request for that account, and the API returns the account together with its transaction rows and the projected occurrences that recurring rules generate. The reply is JSON, a text format that carries structured data, and plain TypeScript functions in `frontend/src/domain/` — the frontend domain layer — turn those rows into the labels and amounts the table draws.

Some rows come from recurring rules whose amount is not fixed in advance. `TransactionsPanel` renders those rows with the text `Varies` through its `TransactionAmount` component, because `TransactionAmount` shows a money figure only when the row's `amountKnown` flag is set. A projection is the app's forecast of future transactions, and the amount of a formula-driven occurrence is computed there and can differ from one occurrence to the next.

Two developer-authored domain files used to supply figures for those rows. `frontend/src/domain/resolvedTransactionAmounts.ts` exported `resolveTransactionAmounts`, which grouped projected occurrences by transaction definition and picked the earliest one as a representative amount so a calculated row would not dead-end at an unavailable label. `frontend/src/domain/nextProjectedPayments.ts` exported `nextProjectedPayments`, which picked the earliest server-projected requested payment after today for each rule and summed same-day fragments so the income list and the bill-candidate list described the same upcoming payment. The only reader of either export was its own test; no screen imported either one. They were written when Safe Spending estimated income from expanded schedules. Safe Spending now uses a cash-backed budget and takes payday values from the server's `forecastPaydays`, so no screen asks for either figure.

The leftover plumbing is the `resolvedAmounts` prop on `TransactionsPanel` — a prop is a value a parent React component passes to a child. `AccountSections`, the only place that renders `TransactionsPanel`, never supplies `resolvedAmounts`, so calculated rows already show `Varies`. Five more named exports are each defined once and read nowhere else: `daysBetweenInclusive` in `frontend/src/domain/format.ts`, `isArchivedAccount` in `frontend/src/domain/model.ts`, `fundingGapCaption` in `frontend/src/domain/fundingGaps.ts`, `ALL_MOVEMENTS` in `frontend/src/domain/flowDiagram.ts`, and `templateById` in `frontend/src/domain/amountCatalog.ts`. The live paths that must stay are `forecastPaydays` for payday values and `scheduleTransaction`'s `resolved` argument, which `ScheduleHistory.tsx` still passes inline.

## Executive summary

Two helpers in the frontend domain layer stay exported although no screen imports them, and one component carries a prop its only render site never supplies. `nextProjectedPayments` picks the earliest projected payment per rule and has no caller or test; its caller was removed when Safe Spending moved to a cash-backed budget and payday values now come from `forecastPaydays`. `resolveTransactionAmounts` summarizes projected amounts for a "Varies" fallback in calculated rows, but its only caller is its own test. `TransactionsPanel` still accepts a `resolvedAmounts` map for the representative amount, yet its only render site in `AccountSections` never passes it, so calculated rows already show "Varies".

Five more exports — `daysBetweenInclusive`, `isArchivedAccount`, `fundingGapCaption`, `ALL_MOVEMENTS`, and `templateById` — are referenced only where they are defined. The cost is two dead files with tests, an unused prop threaded through a component, and exports that invite future callers to depend on code with no live use. The single action is to delete them while leaving the live calculation paths untouched.

## Recommended action

Delete `nextProjectedPayment.ts` and `resolvedTransactionAmounts.ts` with their tests. Remove the `resolvedAmounts` prop, its type import, `selectedResolved`, and the `resolved` argument from `TransactionsPanel`, making `TransactionAmount` always take the no-resolved branch. Delete the five unreferenced exports and their unused imports, dropping the `dateLabel` or `money` import in `fundingGaps.ts` only if the caption was their sole use there. Keep the `resolved` parameter on `scheduleTransaction`, which `ScheduleHistory.tsx` still passes inline.

## Before and after

Before: two domain helpers exist for payment figures no render path produces, `TransactionsPanel` accepts a `resolvedAmounts` map its only render site never passes, and five exports have a single definition site.

After: those files, tests, the prop, and the five exports are gone. Calculated rows still show "Varies", and the live paths (`forecastPaydays` for payday values and `scheduleTransaction`'s `resolved` argument) remain as they are.

```mermaid
flowchart LR
  Before["Dead helper files, tests, unused prop, 5 exports"] -->|remove| After["Only live calculation paths remain"]
```

## Expected improvement

This is a structural cleanup: it removes dead surface without changing any rendered result. The payment and amount code becomes easier to maintain because there is one live path per concern and no unused prop for a future reader to trace. No speed, line-count, or bundle savings were measured; no benchmarks were run.

## Alternatives considered

Leave as is: keeps two dead files with tests and a prop that implies calculated rows show a precise amount when they show "Varies"; rejected because the behavior is already dead. Add callers to keep the helpers: would mean inventing a live use for a figure the product no longer shows, which is speculative. Wire the resolved-amount helper back in instead of deleting it: its comment describes a real product need, but no screen currently requests the value, so this stays deferred until a caller is confirmed.

## Downside of rejecting

The two dead files and their tests keep being carried through every refactor, and the `resolvedAmounts` prop keeps suggesting that calculated rows display a resolved value when they show "Varies". The five single-definition exports keep inviting callers to depend on code with no contract. Any change to projection code would still need checking against paths that nothing executes.

## Verification

Verify with typecheck, the unit suite, a repo-wide grep for each name, and the account browser regression. Rendered amount text for calculated rows must remain "Varies", which is current behavior. The resolved-amount helper's comment describes a real product need, so check whether a caller is intended to be re-wired rather than deleted.

References: `frontend/src/domain/nextProjectedPayment.ts:1-41`; `frontend/src/domain/resolvedTransactionAmounts.ts:1-48`; `frontend/src/pages/accounts/TransactionsPanel.tsx:21,28,36,59-61,145,162,176-214`; `frontend/src/pages/accounts/AccountSections.tsx:352-358`; `frontend/src/domain/format.ts:61-65`; `frontend/src/domain/model.ts:32-34`; `frontend/src/domain/fundingGaps.ts:297-300`; `frontend/src/domain/flowDiagram.ts:18`; `frontend/src/domain/amountCatalog.ts:265-267`.
