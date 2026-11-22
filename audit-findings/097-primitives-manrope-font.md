---
id: 097
title: Update the retired font in the primitives artifact
scope: doc-audit-reference
status: accepted
---

## Executive summary

The typography decision to use Geist and Merriweather was applied to the controlling docs and CSS, but this documentation artifact still hardcodes `font-family: "Manrope"`. A repo-wide search finds the name only here and in the historical finding 011 record. A reader using the primitives page, which shows the project's UI building blocks, sees a font the project no longer uses. The fix is to swap the one literal to the adopted UI stack.

## Recommended action

Swap the single `Manrope` literal in the primitives page to the adopted UI font stack matching `tokens.css`. Do not add a new font definition. No CSS or code change beyond that literal is needed.

## Before and after

| | Font literal in the artifact |
|---|---|
| Before | `font-family: "Manrope"` |
| After | The adopted UI stack from `tokens.css` (Geist and Merriweather), with no new font definition |

```mermaid
flowchart LR
  subgraph before[Before]
    A[Hardcoded Manrope literal]
  end
  subgraph after[After]
    B[Adopted UI stack from tokens.css]
  end
```

## Expected improvement

The primitives page reflects the current typography decision, so readers no longer see a retired font. This is a documentation-accuracy improvement rather than a measured speed or size gain; no benchmarks were run for this finding.

## Alternatives considered

- Leave as is. The artifact keeps showing a font that no other doc or CSS file uses. Rejected.
- Reintroduce Manrope as a supported font. That would reverse the documented typography decision for the sake of one artifact. Rejected.

## Downside of rejecting

The retired font stays on the primitives page, and a repo-wide `Manrope` search will keep returning a live artifact alongside the historical record, which can confuse a reader about what the project uses.

## Verification

Confirm a `Manrope` search returns only the historical 011 record. No browser render was performed, so the visual result is unverified. This is a proposed acceptance check, not a recorded result.

References: `docs/primitives.html:62`; `docs/UI_UX_PRINCIPLES.md:276-278`; `frontend/src/styles/tokens.css:10-12`; `audit-findings/011-typography-decision.md:10,14-16`.
