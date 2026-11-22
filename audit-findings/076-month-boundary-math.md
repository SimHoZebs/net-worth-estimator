---
id: 076
title: Leave one owner for month-boundary math
scope: frontend-domain
status: accepted
---

## Scenario

The app's Cash flow screen shows money moving between accounts over a chosen period, with a date-range picker above the diagram offering presets such as "This month", "Last month", "Last 3 months", "Year to date", and "Last 12 months". When you open the screen or pick a preset, the browser asks the API for the flow data for that window and the API replies with the matching transactions as JSON, a text format for exchanging structured data. Choosing a preset also runs a frontend domain helper—a plain function that shapes data for display—that turns the friendly label into a concrete start and end date. That calculation must find the first and last day of a month correctly at month ends and in leap years, including when the requested day does not exist in that month. The shared helper `clampMonth` already did this for the forecast horizon label in `horizonDate`, using UTC—a clock-independent time standard that keeps dates stable across time zones—and day 31 to mean "the last day of the month". The flow-window helpers `firstOfMonth` and `lastOfMonth` instead reimplemented the same rule with their own UTC math. Two exports, `firstDayOfMonthIso` and `lastDayOfMonthIso`, existed only so the flow-window test could assert those boundaries; both helpers and the wrappers are internal, with no screen calling them directly.

## Executive summary

Two frontend helpers compute the first and last day of a month with their own UTC math, duplicating the clamped-month formula that `clampMonth` already owns for `horizonDate`. Leap-year and month-end correctness is therefore maintained in two live files, and the `flowWindow` test pins its own copy instead of the shared one. Two more exports, `firstDayOfMonthIso` and `lastDayOfMonthIso`, exist only to serve that test.

A third owner, `addMonthsClamped`, is removed by finding 074 and `monthEndIso` goes with the same dead layer. The single action is to make `firstOfMonth` and `lastOfMonth` call `clampMonth`, leaving one owner, and delete the two test-only wrappers.

## Recommended action

Make `firstOfMonth` and `lastOfMonth` call `clampMonth` with day 1 and day 31, leaving `clampMonth` as the sole owner, and delete the two test-only wrappers and their cases. No new helper is created.

## Before and after

Before: `firstOfMonth` and `lastOfMonth` each compute their own month-end with UTC math, and the test uses dedicated `firstDayOfMonthIso` and `lastDayOfMonthIso` wrappers. There are two live copies of the formula.

After: both helpers call `clampMonth` with day 1 and day 31, and the wrappers and their test cases are gone. One owner remains.

```mermaid
flowchart LR
  Before["firstOfMonth and lastOfMonth do their own UTC math"] -->|delegate| After["clampMonth is the sole owner"]
```

## Expected improvement

Structural: leap-year and month-end correctness is maintained in one place, so a future change cannot fix one file and miss the other, and the test now exercises the shared owner. No savings were measured and no benchmarks were run, so this is a maintainability improvement rather than a measured one.

## Alternatives considered

Leave as is: keeps two independent implementations of the same formula and a test that pins a copy rather than the owner; rejected because that drift risk is the whole problem. Create a new shared helper: unnecessary because `clampMonth` already is the owner, and the finding explicitly creates none. Keep the test wrappers: they exist only for the test and would reintroduce a second surface; rejected.

## Downside of rejecting

Leap-day and month-end fixes would still need to be applied in two files, and a change to `clampMonth` could leave `flowWindow` silently disagreeing with `horizonDate`. The test would keep guarding a copy rather than the live rule, so a regression in the shared formula could go unnoticed on the `flowWindow` side.

## Verification

Verify that the existing leap assertions for `2024-02-29` and `2023-02-28` pass unchanged. `clampMonth` takes a zero-based month and anchors at 12:00 UTC, so confirm `flowWindow`'s `getUTCMonth()` basis before swapping.

References: `frontend/src/domain/format.ts:67-80`; `frontend/src/domain/flowWindow.ts:15-37`; `frontend/src/domain/result.ts:121-147`; `frontend/src/domain/flowWindow.test.ts:12-20`.
