---
id: 110
title: Keep font family strings in one owner
scope: ui-ux
status: needs-review
---

`index.css` declares `--font-sans` and `--font-heading` with literal Geist and Merriweather strings. `tokens.css` declares the same families as `--font-ui` and `--font-display` and then redeclares `--font-sans` to `var(--font-ui)`, so the literal in `index.css` is shadowed. More importantly `font-heading`, used by five dialog and card title recipes, stays a literal in `index.css` while display headings in `typography.css` follow `--font-display`. Changing the documented owner leaves title utilities stale.

Keep the family strings only in `tokens.css`, point `index.css` at `var(--font-ui)` and `var(--font-display)`, and remove the duplicate `--font-sans` from the `tokens.css` inline theme block.

Verify with a grep that the Geist and Merriweather literals appear once in `frontend/src/styles` and that computed fonts for body, `h1`, and `font-heading` are unchanged in light and dark themes.

References: `frontend/src/styles/index.css:99-100`; `frontend/src/styles/tokens.css:10-11,72`; `frontend/src/styles/typography.css:21,25`; `frontend/src/components/ui/card.tsx:40`.
