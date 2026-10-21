# Typography roles

Choose a font by the text's role, never by its page or component.

| Role | Font | How to apply it |
| --- | --- | --- |
| UI and data | Manrope | Default for body text, navigation, labels, section headings, controls, tables, chart text, amounts, dates, and status results. |
| Display title | Newsreader | `h1` automatically. Use `type-display` for other display headings. Shared `Modal` and right-side `Drawer` titles apply it. |
| Standalone value | Manrope with tabular numerals | Add `type-value` to headline amounts, dates, and evaluation outcomes. Use the same role in a card and its detail view. |
| Technical text | System monospace | `pre`, `code`, `kbd`, and `samp` automatically. Add `type-code` to editable JSON fields. |

Newsreader gives the workspace its editorial title style. Manrope keeps financial
data consistent across summaries, tables, charts, and editable controls. A larger
font size does not make an amount or date a display title. An evaluation outcome
keeps the value role even when it says “Already reached” or “Beyond this horizon.”

Section headings (`h2`–`h6`) and mobile topbar labels use Manrope. A plain modal
title also uses Manrope because it acts as a compact context label. Keep workspace
`h1` visibility and heading semantics unchanged when you select a typeface.

## Ownership

- `tokens.css` owns `--font-ui`, `--font-display`, and `--font-code`.
- `typography.css` is the only application stylesheet that selects `font-family`.
- Component styles own size, weight, spacing, color, and layout.
- Use `font: inherit` when a control must inherit all surrounding text metrics.
- Do not add component font-family declarations, inline font styles, SVG font
  attributes, or local overrides of the family tokens.
- Use `rem` for new font sizes. Keep line heights unitless.

For a new summary card, apply `type-value` to its main result. Its labels and
section heading already inherit the UI role. For a new JSON editor, apply
`type-code` to its textarea. Neither case needs another font declaration or token.

The standalone static `public/404.html` page uses system fonts by design. It does
not load the application bundle or participate in the application font contract.

## Development guidance

Shared defaults and role classes keep components consistent. Font names, sizes,
and role assignments remain design choices, rather than test contracts.

Run `npm run lint:typography` from `frontend/` for ownership warnings. The normal
lint command, pre-push hook, and CI also run it. Warnings do not fail the command.

`scripts/lint-typography.ts` flags local font-family choices, family-token
overrides, family-changing `font` shorthands, and inline font properties. Its unit
tests cover detection logic with isolated examples, not application fonts or
markup. Change shared fonts or add a role without updating typography assertions.
