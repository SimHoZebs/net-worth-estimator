# Tailwind styles and typography

## Style scale

Tailwind CSS 4 uses the Vite plugin and CSS-first configuration in `index.css`
and `tokens.css`. The native reset remains in place. Preflight is not imported.

- Ordinary padding, margins, and gaps use `0`, `0.5`, `1`, `2`, `3`, `4`, `5`,
  `6`, `8`, or `12`. These are nine nonzero steps, from 2px to 48px at the default
  root font size. `px` remains available for hairline alignment.
- Use `gap-1` for a small gap, rather than separate `gap-[4px]` and `gap-[5px]` values.
- Use standard text sizes and weights. Shared controls use `rounded-control`,
  surfaces use `rounded-surface`, and overlays use `shadow-overlay`.
- Use only these two nonzero radii. Square, pill, inherited rounding, and SVG
  geometry remain separate. Use named letter spacing, such as `tracking-tight`.
- Fixed control and icon dimensions use Tailwind sizing utilities. Large widths
  use named containers such as `max-w-sm`, `w-xl`, or `max-w-7xl`. Use flex, grid,
  fractions, and `min-w-0` before width arithmetic. Intrinsic `ch` constraints and
  runtime chart values remain available.
- Use stock `sm`, `md`, `lg`, `xl`, and `2xl` viewport breakpoints, or named
  container breakpoints. Navigation switches at `md`. Charts and sheets switch
  at `sm`. JavaScript uses `viewportQueries` from `state/useMediaQuery.ts`.
- Semantic colors such as `bg-surface` and `bg-primary` reference Tailwind's stock
  stone, emerald, amber, and red palettes. `themes.css` supplies the dark roles.
- Use arbitrary values only for runtime variables, chart geometry, and intrinsic
  constraints. Grid tracks can reference stock `--container-*` variables and
  `--spacing()` values. Preserve pixel coordinates inside SVG geometry.
- Keep finite variants as complete literal classes. Tailwind does not detect
  interpolated fragments such as `bg-${tone}-500`.

`npm run lint:styles` enforces finite spacing. Class and `@apply` utilities also
enforce radius roles and reject custom numeric breakpoints, arbitrary tracking,
large numeric widths, and literal layout arithmetic. `npm run lint:fix`
consolidates spacing and radius aliases.
The check covers JSX, class maps, static `*Styles` exports, CVA, `mergeStyles()`,
and CSS declarations. It does not constrain runtime data or SVG coordinates.

The workspace footer uses sticky positioning in normal document flow. Draft
actions and notifications stack there at their actual heights. Do not restore
fixed sidebar-offset calculations or estimated bottom-clearance padding.

## Typography roles

Choose a font by the text's role, never by its page or component.

| Role             | Font                          | How to apply it                                                                                                                |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| UI and data      | Manrope                       | Default for body text, navigation, labels, section headings, controls, tables, chart text, amounts, dates, and status results. |
| Display title    | Manrope                       | `h1` automatically. Use `type-display` for other display headings. Shared `Modal` and right-side `Drawer` titles apply it.     |
| Standalone value | Manrope with tabular numerals | Add `type-value` to headline amounts, dates, and evaluation outcomes. Use the same role in a card and its detail view.         |
| Technical text   | System monospace              | `pre`, `code`, `kbd`, and `samp` automatically. Add `type-code` to editable JSON fields.                                       |

Manrope keeps titles and financial data consistent across summaries, tables,
charts, and editable controls. A larger font size does not make an amount or date
a display title. An evaluation outcome
keeps the value role even when it says “Already reached” or “Beyond this horizon.”

Section headings (`h2`–`h6`) and mobile topbar labels use Manrope. A plain modal
title also uses Manrope because it acts as a compact context label. Keep workspace
`h1` visibility and heading semantics unchanged when you select a typeface.

## Ownership

- `tokens.css` owns `--font-ui`, `--font-display`, and `--font-code`.
- `typography.css` is the only application stylesheet that selects `font-family`.
- Tailwind utilities own size, weight, spacing, color, and layout.
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
lint command and pre-push hook also run it. Warnings do not fail the command.

`scripts/lint-typography.ts` flags local font-family choices, family-token
overrides, family-changing `font` shorthands, and inline font properties. Its unit
tests cover detection logic with isolated examples, not application fonts or
markup. Change shared fonts or add a role without updating typography assertions.

## Design-system layers

Tailwind implements the design system. It does not define component boundaries.

1. **Tokens:** `tokens.css` owns semantic color, font, radius, and shadow roles.
   `themes.css` changes color roles for dark mode. Reuse the standard spacing
   scale for layout. Add component-specific tokens only when a real theme need
   exists. Do not copy a global token into a per-component alias.
2. **Style recipes:** `buttonStyles.ts`, `fieldStyles.ts`, and `tableStyles.ts`
   export typed recipes independently of React. Use CVA for stable variants.
   Use complete utility strings for simple shared appearance.
3. **React primitives:** use components for native contracts, accessible labels,
   structure, or behavior. Buttons preserve native submission and refs. Fields
   connect labels and descriptions. Tables preserve native table composition.
   Dialogs own focus, dismissal, and named header/body slots.
4. **Composition:** use Tailwind flex, grid, spacing, and responsive utilities
   directly. Do not create Box, Stack, Text, or SectionHeader wrappers solely
   to conceal utilities. Repeated appearance alone can remain a style recipe.

Use `mergeStyles()` at a primitive's external `className` boundary. It resolves
conflicts and recognizes the semantic radius and shadow tokens. Ordinary local
class strings need no merging helper. Give callers explicit props or slots
instead of selectors that reach into another component's private markup.

Use native `aria-*` and `data-*` attributes for states and finite variants.
Use semantic browser-test locators first, then explicit `data-testid` hooks.
Do not retain inert class names as a test API. Keep residual component CSS only
for complex chart textures. Global reset, typography, focus, and motion
preferences remain CSS responsibilities.

`lint:styles` enforces the spacing scale and focused design-system rules.
It does not decide whether a component abstraction earns its cost. Layout,
intrinsic constraints and chart geometry stay flexible. Responsive layouts use
Tailwind's named breakpoint vocabulary.
Palette utilities belong in the token owner. Component `@apply` selector APIs
and arbitrary selectors that name private classes fail the lint check.

Pass runtime values through `cssVariables()` from `components/cssVariables.ts`.
The helper accepts only custom property names, such as `--progress-width` or
`--account-color`. CSS owns the declarations and token mixtures that consume them.
Do not put fixed declarations or variant maps in JSX `style` props.

Library-managed animation styles and imperative browser state, such as scroll
locks and the active color scheme, remain separate from component appearance.
