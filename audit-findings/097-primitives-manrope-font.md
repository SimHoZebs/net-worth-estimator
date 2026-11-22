---
id: 097
title: Update the retired font in the primitives artifact
scope: doc-audit-reference
status: accepted
---

## Scenario

The primitives page is a documentation artifact, not a product screen. A developer opens the static HTML file `docs/primitives.html` in a browser to see the project's UI building blocks and the styles applied to them. Because it is a static file, the browser loads it directly and no API request takes place. The style that matters is a CSS `font-family` declaration on the page's body, a rule that tells the browser which typeface to use for text. A typeface is the design of the lettering, and a font stack is the preferred typeface followed by fallback choices; the body rule currently names `Manrope`. The controlling typography rules live in `docs/UI_UX_PRINCIPLES.md`, which assigns Geist to UI, data, and value roles and Merriweather to display headings, and in `frontend/src/styles/tokens.css`, where the `--font-ui` variable is the stack `"Geist Variable", sans-serif` and `--font-display` is `"Merriweather Variable", serif`. The page should reflect that adopted choice. Instead the single `font-family` literal on the page names the retired typeface Manrope, which no current style or controlling document uses, so a reader sees typography the project no longer ships. Because the UI principles and token styles are the sources of truth, that one literal on the page is what must change.

```mermaid
flowchart LR
  A[Developer opens docs/primitives.html in a browser] --> B[Browser loads the static file with no API request]
  B --> C[Body font-family rule renders Manrope]
  C --> D[Reader sees a typeface the project no longer ships]
  E[docs/UI_UX_PRINCIPLES.md and frontend/src/styles/tokens.css adopt Geist and Merriweather] -.->|sources of truth| C
```

## Executive summary

The typography decision to use Geist and Merriweather was applied to the controlling docs `docs/UI_UX_PRINCIPLES.md` and `frontend/src/styles/tokens.css`, but the documentation artifact `docs/primitives.html` still names the retired font Manrope in its body `font-family` rule. A repo-wide search finds the name only in that artifact and in the historical finding 011 record `audit-findings/011-typography-decision.md`. A reader using the primitives page, which shows the project's UI building blocks, sees a font the project no longer uses. The fix is to swap the one literal to the adopted UI stack.

## Recommended action

Swap the single retired font literal on the primitives page to the adopted UI font stack matching the token styles. Do not add a new font definition. No CSS or code change beyond that literal is needed.

## Before and after

| | Font literal in the artifact |
|---|---|
| Before | A font-family rule naming the retired Manrope font |
| After | The adopted UI stack from the token styles, with no new font definition |

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
- Reintroduce the retired font as a supported font. That would reverse the documented typography decision for the sake of one artifact. Rejected.

## Downside of rejecting

The retired font stays on the primitives page, and a repo-wide search will keep returning a live artifact alongside the historical record, which can confuse a reader about what the project uses.

## Verification

Confirm a `Manrope` search returns only the historical 011 record. No browser render was performed, so the visual result is unverified. This is a proposed acceptance check, not a recorded result.

References: `docs/primitives.html:62`; `docs/UI_UX_PRINCIPLES.md:276-278`; `frontend/src/styles/tokens.css:10-12`; `audit-findings/011-typography-decision.md:10,14-16`.
