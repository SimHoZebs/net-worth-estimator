---
id: 075
title: Delete unreferenced domain exports and the unused prop
scope: frontend-domain
status: accepted
---

## Scenario

On an account detail screen the app lists that account's transactions, including calculated rows for recurring rules whose exact amount is not known in advance. Those rows show the word "Varies" rather than a precise figure, because the amount is computed during projection—the app's forecast of future transactions—and changes each occurrence. When the screen loads, the browser asks the API for the account model and its projected transactions; the API replies with structured data as JSON (a text format for exchanging data), and the frontend domain layer—plain functions that shape server data for display—turns it into the labels and amounts you see. A helper named `resolveTransactionAmounts` existed to pick the earliest projected occurrence for each rule and feed a resolved amount into that row, while `nextProjectedPayments` picked the earliest projected payment per rule so income and bill lists would describe the same upcoming occurrence. They were written when Safe Spending still estimated income from expanded schedules; that feature moved to a cash-backed budget where payday values come from the server's `forecastPaydays`, and no screen now requests either figure. Both helpers are internal: their only caller was their own test, never a screen. The `resolvedAmounts` prop—a value a parent component passes to a child component—is the leftover plumbing meant to carry that figure to the row.

## Executive summary

Two helpers in the frontend domain layer keep an API surface that no screen uses, and one component carries a prop its only render site never supplies. `nextProjectedPayments` picks the earliest projected payment per rule and has no caller or test; its caller was removed when Safe Spending moved to a cash-backed budget and payday values now come from `forecastPaydays`. `resolveTransactionAmounts` summarizes projected amounts for a "Varies" fallback in calculated rows, but its only caller is its own test. `TransactionsPanel` still accepts a `resolvedAmounts` map for this figure, yet its only render site in `AccountSections` never passes it, so calculated rows already show "Varies".

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
