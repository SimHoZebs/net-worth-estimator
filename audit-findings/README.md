# shadcn Base UI migration audit

Audited `feat/shadcn-full-adoption` at `a6b19745` plus the existing working changes on 2026-11-14. Application files were not edited. Other work continued during inspection, including an untracked integration debug spec. These findings describe the inspected sources, not a frozen runtime build.

## Original audit verdict

The foundation is installed and many primitives are genuinely adopted. Full visual and behavioral adoption is incomplete. Legacy appearance is deliberately reapplied through wrappers and copied classes, a preset token has the wrong meaning, and important interactions still bypass the library. Green regression tests alone cannot establish completion.

| ID | Title | Scope | Status |
| --- | --- | --- | --- |
| 001 | Restore the meaning of muted | ui-ux | accepted |
| 002 | Stop reapplying the legacy visual system | ui-ux | accepted |
| 003 | Let the detail sheet own modal behavior | frontend-state | accepted |
| 004 | Replace the custom date-range widget | frontend-domain | accepted |
| 005 | Finish selection and field adoption | frontend-domain | accepted |
| 006 | Use an alert dialog for discard confirmation | frontend-state | accepted |
| 007 | Consolidate notifications on Base UI Toast | frontend-state | accepted |
| 008 | Make table adoption substantive | contracts-types | accepted |
| 009 | Bring server-rendered auth into the visual system | backend-api-persist | accepted |
| 010 | Verify adoption instead of preserving old implementation contracts | deploy-build-test | superseded |
| 011 | Update the documented typography decision | doc-audit-reference | accepted |

## Implementation outcome

The complete migration replaces the competing presentation and interaction
owners. The statuses above record accepted audit decisions; the outcomes below
record their implementation rather than rewriting the original evidence.

| Finding | Implemented outcome |
| --- | --- |
| 001 | `muted` is a surface; subdued text uses `muted-foreground`. |
| 002 | Retired aliases, recipes, wrappers, and broad focus overrides are removed. Lucide is the single icon library. |
| 003 | The detail is a modal Sheet with library portal/focus ownership, labeled fields, standard footer actions, and guarded dismissal. |
| 004 | Date ranges use Calendar with Popover or compact Dialog and an explicit local-date/ISO boundary. |
| 005 | Application selects and checkboxes use canonical controls; selected values resolve to display labels. |
| 006 | Dirty-close confirmation uses nested AlertDialog while busy and failed-save protection remains application-owned. |
| 007 | Base UI Toast owns the sole notification lifecycle; application policy supplies keys, actions, and identity-scope clearing. |
| 008 | Tables have one keyboard-accessible scroll owner and no unused header-only TanStack state. |
| 009 | Plain-HTML identity pages share the frontend's pure button/input recipes; image inputs and reuse invalidation follow that source. |
| 010 | The broad UI suite is retired by user decision. One observed selection-label regression is reintroduced. Financial/API/security/isolation tests remain. |
| 011 | Typography documentation matches Geist and Merriweather. |

The shell also uses the canonical Sidebar instead of window-swipe state and a
custom modal-presence store. Obsolete dialog motion and positioning helpers
are removed.

Verification on the final corrected candidate passed frontend lint/typecheck, 89 unit
files with 692 tests, production build, auth lint/typecheck/tests/build, eight
runner/image contracts, and the focused selection-label browser regression.
The design-system scan reports zero application legacy aliases, raw selects,
raw checkbox inputs, and preset focus-ring suppressions. Workflow actionlint
and install consistency also passed.

Manual production-preview checks confirmed account/debt and purchase creation,
one save notification, detail modal containment, Select-only Escape, dirty
Continue/Discard, return focus, and readable detail controls at desktop and
390px mobile widths. The detail measures 576px on desktop and the mobile page
has no horizontal overflow. These checks are representative, not a claim that
the retired UI suite's coverage has been restored. The production-build browser
regression also passed.

Final review corrections constrain long dialogs to a scrollable viewport,
preserve manual notification dismissal, distinguish real account IDs from the
empty selection without a sentinel, remove remaining copied card/table recipes,
consolidate evidence-table scrolling, restore guest-label contrast, and use
nested purchase discard confirmation. Official Tailwind Preflight supplies the
browser baseline expected by the preset. Tooling now rejects the retired token
roles across color utility prefixes.

Mobile debt review confirmed a scrollable 812px popup inside a 390×844 viewport
with its footer reachable. A real failed budget-settings save retained its retry
action beyond 6.5 seconds, and retry succeeded after restoring the connection.
Guest-label contrast measures 5.229:1 in light and 8.828:1 in dark. The additional
focused editor regression covers the observed imported-account ID collision.
Hosted gates and deployment results are recorded separately at shipment.

## Vocabulary consolidation

| User term | Code names grouped under it |
| --- | --- |
| Preset appearance | legacy recipes, visual owner, token bridge, pill recipes |
| Notifications | ToastCard, notifyError/notifySuccess, Sonner, Base UI Toast |
| Detail sheet | Drawer, DetailPortal, Sheet, transaction inspector |
| Date range | MonthCalendar, anchored popover, flow window picker |

## Measurements and limits

Read-only scan of application TSX under `frontend/src`, excluding `ui` directories and test/spec files: 31 raw select elements across 12 files, 7 checkbox inputs across 5 files, and 72 occurrences of `focus-visible:ring-0` across 33 files. There were no application imports of `ui/calendar`, `ui/toast`, or `ui/command`. Unused source does not establish production bundle weight.

Sources were checked against official shadcn Base Nova registry examples and Base UI documentation. Stock translucent dialog overlays match the upstream source and are not an audit finding. Ordinary controlled state, financial validation, and typed upstream optional props/casts are not failures of adoption by themselves.

`git diff --check` passed before these reports were written. No app tests, build, or browser journeys were run for this source audit. Keyboard behavior, visual rendering, and production behavior remain unverified. Verification sections in individual findings are proposed acceptance checks, not claimed results.

## Recommended implementation order

1. Restore preset token meanings, remove competing appearance and focus overrides, and establish a reference screen using the existing Base Nova preset.
2. Complete one detail-sheet journey with normal fields, library selection controls, nested confirmation, and correct modal behavior before applying the composition elsewhere.
3. Replace the date-range widget and notification stack. Simplify tables and align server-rendered auth.
4. Verify light/dark desktop/mobile appearance and keyboard journeys. Remove retired helpers. Under the subsequent user decision, retire existing UI tests and add focused UI regression tests only as actual regressions are discovered; retain domain/API/security checks.

Keep financial rules, permissions, UTC interpretation, failed-save retry, and unsaved-change protection. shadcn supplies interaction primitives, not those product rules. A thin domain composition is useful; a second styling or focus engine is not.

## Documentation-only finding

Finding 011 concerns a stale controlling typography decision. Update it alongside adoption so future work does not restore the retired font. The audit does not propose changing unrelated UI principles.
