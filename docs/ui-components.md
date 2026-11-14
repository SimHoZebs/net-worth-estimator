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

## Card composition

`Card` owns vertical rhythm and footer chrome, but horizontal padding lives in
`CardHeader` and `CardContent`. Render flow content only through those slots
(plus `CardFooter`), and compose `CardTitle` inside `CardHeader`. Content
placed directly in `Card` renders edge-to-edge with no horizontal padding.

Native headings nested in `CardTitle` for outline semantics keep their level,
ID, and layout classes, and inherit the canonical title composition
(Merriweather, size, weight, line height) from a `CardTitle`-owned
direct-child rule — the global h2–h6 base styles apply everywhere else and
stay untouched. Do not add per-consumer font resets on those headings.

## Sheet composition

Right-side sheets share one shell geometry: full width on mobile, `xl`
(576px) on desktop, owned by `SheetContent`. Compose `SheetHeader` (which
reserves the close-button zone centrally — title actions stay local content),
`SheetTitle`, an optional `SheetDescription`, scrollable `SheetBody`
(`min-h-0 flex-1 overflow-y-auto` with scroll chaining contained), and an
optional `SheetFooter` for sheets that have actions. Do not reapply width,
padding, or scroll recipes per consumer, and do not add a footer when a
read-only sheet has no actions. All right sheets share this geometry, including
nested ones; the mobile navigation sheet keeps its own stock geometry.

Horizontal tab strips use the central `TabsList scrollable` prop, which owns
inline overflow, the scroll offset boundary, and the bottom paint space for
the selected underline. Consumers set only domain margins and gaps; no
per-consumer overflow or clip hacks.

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
