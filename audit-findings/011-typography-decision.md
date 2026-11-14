---
id: 011
title: Update the documented typography decision
scope: doc-audit-reference
status: accepted
---

Priority: medium. Documentation-only correction.

The UI principles still require Manrope for UI, data, display, and value roles. The chosen preset and current styles use Geist for UI/data and Merriweather for display headings. A future agent following the controlling principle could restore the retired appearance while believing it is fixing consistency.

Update the typography decision to describe the adopted preset and current role mapping, keeping typography roles centrally owned. Record the migration target as preset adoption rather than old-pixel preservation. Do not change unrelated product interaction principles to justify library defaults.

References: `docs/UI_UX_PRINCIPLES.md:276`, `frontend/src/styles/tokens.css:14`, `frontend/src/styles/index.css:96`, `frontend/src/styles/typography.css:20`.

Verification: the documented font families and roles match the chosen preset and computed heading/body styles. Search current application sources and controlling UI documentation for retired font requirements. This audit verified the source contradiction; it did not render the fonts in a browser.
