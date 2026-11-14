# UI component ownership

Waypoint uses the shadcn **Base UI / Nova** component system, the taupe theme,
Geist body text, Merriweather display headings, and Lucide icons. The registry
configuration lives in `frontend/components.json`; reusable primitives live in
`frontend/src/components/ui/`.

## Appearance

The preset owns standard control sizes, variants, spacing, selected states,
surfaces, radii, and focus treatment. Pages compose these parts; they do not
reapply the retired button, field, table, or pill recipes after importing a
shadcn primitive. Use layout utilities for domain-specific content structure,
not as a second component theme.

Use the preset token meanings. In particular, `muted` is a background and
`muted-foreground` is subdued text. Financial success, warning, and chart roles
may extend the theme where they communicate information the preset does not
define. They do not replace ordinary button/input appearance.

## Interaction

Base UI owns popup placement, selection keyboard behavior, modal containment,
layer dismissal, and focus restoration. Compose `Dialog`, `Sheet`,
`AlertDialog`, `Select`, `Popover`, and `Calendar` rather than implementing a
second focus trap, popup positioner, or calendar grid.

The application still owns financial validation, permissions, dirty state,
busy state, revision conflicts, API payloads, and retry after failed saves.
Controlled primitive state is appropriate when needed for those rules or route
navigation. A dirty editor requests a nested discard confirmation; it does not
silently remove its unsaved-change protection to match a library default.

Notifications use one manager and one viewport. Keyed replacement, persistence
until manual dismissal or recovery, identity scope clearing, and domain actions
are application policy. The viewport sets the Base UI provider timeout to zero
so errors and confirmations keep their actions available. Notification rendering
and interaction belong to the Base UI Toast composition.

## Composition boundaries

This migration is a presentation and interaction refactor, not a new domain or
persistence model. Small responsibility-based extractions replace duplicated
editor chrome and oversized detail sections. Do not introduce another generic
component framework or a parallel global UI state store.

A future account selector composes the same Select/Combobox parts with account
data. A future financial editor composes the same Field, Dialog/Sheet, footer,
and discard-confirmation parts with its own validator and payload builder.
Neither needs a new visual recipe or custom popup/focus implementation.

## Native boundaries

Date/time text entry, file uploads, links, semantic tables, and form submission
still use native HTML where appropriate. Server-rendered identity pages remain
HTML and share preset styling without acquiring a React runtime. Keep their
autocomplete, CSP, CSRF, and passkey contracts intact.

## Verification

Existing frontend UI tests were intentionally retired. Add a focused UI test
only for an observed regression. Preserve financial-domain, API, authorization,
and user-isolation suites. An empty frontend browser baseline is not browser
coverage.

During migration, verify light/dark desktop/mobile rendering and real keyboard
journeys, including nested Select → Escape, dirty close → Continue/Discard,
date ranges, notifications, and keyboard table scrolling. Record manual
evidence separately from automated gate results. See `TESTING.md`.
