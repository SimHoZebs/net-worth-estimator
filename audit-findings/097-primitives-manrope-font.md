---
id: 097
title: Update the retired font in the primitives artifact
scope: doc-audit-reference
status: accepted
---

The typography decision to use Geist and Merriweather was applied to the controlling docs and CSS, but this documentation artifact still hardcodes `font-family: "Manrope"`. A repo-wide search finds the name only here and in the historical finding 011 record. A reader using the primitives page sees a font the project no longer uses.

Swap the one literal to the adopted UI stack matching `tokens.css`, without adding a new font definition.

Verify that a `Manrope` search returns only the historical 011 record. No browser render was performed, so the visual result is unverified.

References: `docs/primitives.html:62`; `docs/UI_UX_PRINCIPLES.md:276-278`; `frontend/src/styles/tokens.css:10-12`; `audit-findings/011-typography-decision.md:10,14-16`.
