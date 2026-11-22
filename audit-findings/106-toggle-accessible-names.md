---
id: 106
title: Keep a stable name on pin and reveal toggles
scope: ui-ux
status: needs-review
---

## Executive summary

These native buttons change `title` and `aria-label` (the control's accessible name) between "Pin" and "Unpin" or "Hide token" and "Show token" while also setting `aria-pressed` (the attribute that reports a toggle's on or off state). The announced name then asserts the opposite of the pressed state, so a user cannot tell whether the item is pinned. The repository already uses the correct stable-name pattern in pattern review. Keep one name and let `aria-pressed` carry the state.

## Recommended action

Keep one stable name for both `title` and `aria-label` in every state and let `aria-pressed` carry the state. Drop `title` where `aria-label` already names the control. Reuse the pattern-review pattern; nothing new is introduced.

## Before and after

| Control | Before | After |
| --- | --- | --- |
| Pin buttons | Name flips between Pin and Unpin while pressed also changes | One stable name, with `aria-pressed` reporting the state |
| Token reveal button | Name flips between Hide token and Show token | One stable name, with `aria-pressed` reporting the state |

```mermaid
flowchart LR
  A[Name changes with state] --> B[Stable name and aria-pressed carries state]
```

## Expected improvement

Assistive technology reports a constant name and a clear pressed state, so users can tell whether an item is pinned or a token is shown. This is a structural accessibility improvement; no benchmarks were run, so no speed, line-count, or bundle savings are claimed.

## Alternatives considered

- Leave as is — the announced name keeps contradicting the pressed state. Rejected.
- Drop `aria-pressed` and keep the changing name — this removes the contradiction but loses the programmatic state cue and diverges from the repository's own pattern. Rejected.

## Downside of rejecting

The announced name keeps contradicting the pressed state, so a screen-reader user cannot tell whether an item is pinned or a token is revealed.

## Verification

With NVDA or VoiceOver, confirm the name stays constant while only pressed or not pressed changes, for both pin buttons and the token reveal button. This is markup reasoning; no screen-reader session was run. This is a proposed acceptance check, not a recorded result.

References: `frontend/src/components/funding/FundingGapsCard.tsx:156-168`; `frontend/src/pages/evaluations/EvaluationCard.tsx:78-88`; `frontend/src/pages/evaluations/CycleFulfillmentCard.tsx:73-81`; `frontend/src/pages/evaluations/FinancialIndependenceCard.tsx:133-138`; `frontend/src/pages/sources/SyncConnectForm.tsx:77-91`; correct pattern at `frontend/src/components/analysis/PatternReview.tsx:99-120`.
