# shadcn Base UI migration audit

## Post-migration trimming audit

Audited the frozen `origin/main` snapshot `b9e4d85f` on 2026-11-14 in the isolated `audit/shadcn-trimming` worktree. The original checkout's uncommitted account/group work was excluded and left untouched. Findings 001–011 below are historical migration records. The user accepted 014–032 and rejected 012–013, retaining the calendar range picker and drag ordering. Implementation follows those decisions.

**Verdict:** the migration substantially delegates primitive behavior. Remaining worthwhile cuts are concentrated in feature-specific interaction glue, duplicated compositions, and dead code rather than a second global CSS theme. Behavior changes are acceptable when they remove custom logic. Financial correctness, authorization, saved-data integrity, and usable keyboard/focus behavior remain verification constraints.

### Current finding index

| ID | Title | Scope | Status |
| --- | --- | --- | --- |
| [012](012-native-flow-range.md) | Use native date inputs for the flow range | frontend-domain | rejected |
| [013](013-button-only-rule-order.md) | Keep button ordering and remove drag ordering | frontend-state | rejected |
| [014](014-library-owned-tabs.md) | Let Tabs own local selection and panel mounting | frontend-state | implemented |
| [015](015-one-transaction-pager.md) | Use one transaction pager composition | contracts-types | implemented |
| [016](016-shared-receipt-discard.md) | Reuse the receipt discard confirmation | frontend-state | implemented |
| [017](017-shared-purchase-editor-shell.md) | Reuse the purchase editor dialog shell | frontend-domain | implemented |
| [018](018-one-editor-validation-owner.md) | Consolidate repeated editor validation | frontend-domain | implemented |
| [019](019-delete-dead-detail-rows.md) | Delete the unused detail row recipes | contracts-types | implemented |
| [020](020-delete-dead-error-notice.md) | Delete the unused error notice and duplicate field error | contracts-types | implemented |
| [021](021-delete-dead-table-shell.md) | Delete the unused generic table shell | contracts-types | implemented |
| [022](022-remove-unused-date-fns.md) | Remove the unused direct date-fns dependency | deploy-build-test | implemented |
| [023](023-remove-uneditable-ui-preferences.md) | Remove persisted projection controls that no UI edits | backend-api-persist | implemented |
| [024](024-remove-unread-import-flag.md) | Remove the unread global import flag | backend-api-persist | implemented |
| [025](025-single-viewport-subscription.md) | Share the viewport subscription | frontend-state | implemented |
| [026](026-remove-state-aliases.md) | Use React state without selection aliases | contracts-types | implemented |
| [027](027-prune-unused-registry-parts.md) | Prune unused registry component parts selectively | contracts-types | implemented |
| [028](028-radio-owned-single-choice.md) | Use a single-choice control for the movement filter | ui-ux | implemented |
| [029](029-current-error-feedback-docs.md) | Document the current error feedback owners | doc-audit-reference | implemented |
| [030](030-menu-state-overrides.md) | Let menu items own their highlight styling | ui-ux | implemented |
| [031](031-one-brand-recipe.md) | Share the application and sign-in brand recipe | ui-ux | implemented |
| [032](032-toast-merger-import.md) | Use the shared class-merger import in Toast | contracts-types | implemented |

### Priority and tradeoffs

The accepted implementation starts with dead modules/shell and the unused direct dependency (019–022), uncontrolled tabs (014), the pager consolidation (015), and shared editor compositions (016–017). The user rejected native range inputs (012) and button-only rule ordering (013); the calendar and drag dependencies and workflows remain.

For styling, remove popup descendant state overrides (030) rather than rebuilding component recipes. Viewport consolidation (025) is small. Hidden UI preferences and import state (023–024) are adjacent state cleanup, not missing shadcn adoption. Validation consolidation (018) reuses existing validators after an extra Zod layer proved larger; validation alone removes 26 lines. Registry pruning, aliases, radio styling, brand ownership, and the merger import (026–028,031–032) are smaller accepted changes; some reduce concepts without reducing physical lines.

### Vocabulary consolidation for this pass

| User term | Code names grouped under it |
| --- | --- |
| Date range | FlowDateRangePicker, Calendar draft, responsive Popover/Dialog |
| Rule ordering | SortableRow, Reorder, gesture draft, moveBy, persistOrder |
| Transaction pager | TablePagination, Pagination, inline previous/next controls |
| Discard confirmation | askDiscard, useDiscardGuard, DiscardConfirm, nested AlertDialog |
| Local tab selection | tab/view state, useTransactionView, dynamic TabsContent |

### Coverage and measurements

Eight scoped read-only reviews covered all frontend primitive modules and styles, app compositions and UI-state sites, validation/selection/date boundaries, unused imports/dependencies, documentation, persisted UI state, and the server-rendered identity visual boundary. Backend investigation was restricted to UI/domain ownership, not a general backend audit. The separate purchase-capture extension was not part of this web-app migration audit.

The source inventory contains 31 UI primitive TSX files totaling 3,982 lines, 168 application TSX files totaling 29,447 lines, and six CSS files totaling 419 lines. Tests/specs are excluded from TSX counts. These are inventory sizes, not removable-code totals. The two wholly dead custom modules total 95 lines. Calendar and Popover total 304 existing lines, but a native replacement still needs form markup; no net savings or bundle savings have been measured.

shadcn deliberately distributes local component source, and Base UI is unstyled. Registry source, theme tokens, ordinary layout utilities, and controlled state are not redundant merely because they are local. Official [shadcn documentation](https://ui.shadcn.com/docs), registry sources, and [Base UI documentation](https://base-ui.com/react/overview/about) were checked.

### Checked and not recommended for removal

- Keep Select items/label mapping. Empty/async values and the observed label regression make deleting it unsafe; item children alone are not equivalent.
- Keep useful EditorField/EditorSelect/MoneyField compositions. Inlining their markup at every consumer conflicts with the LOC goal.
- Keep transaction identity, financial payload builders, money formatting, UTC timestamp preservation, and server-owned selection semantics. They are domain rules, not widget behavior.
- Keep financial status tokens, chart textures and positional reserve zones, account identity, route focus, and post-mutation focus where the triggering control disappears. Tolerating UI changes does not make inaccessible controls a sensible optimization.
- Keep the adopted Sidebar instead of replacing it with another custom navigation framework. Its left-side mobile Sheet is live. A more basic navigation layout is a possible feature deletion, not evidence that library adoption failed.
- Keep shared Sheet geometry, heading inheritance, table scroll accessibility, actionable notifications, and React-free auth control recipes. They centralize real responsibilities.
- Do not replace calendar-local dates with UTC Dates while leaving a local calendar unchanged. The native-input proposal removes that boundary safely; time-zone shifts are not acceptable simplification.
- Keep the regression-only testing policy and design-system lint. Removing guards to lower LOC does not reduce custom UI implementation. Historical audit records are not runtime migration code and should not be retired through database migration procedures.
- Removing fonts/animation dependencies would change preset design for little custom-code reduction. Moving shadcn to development dependencies is packaging hygiene, not a primary trimming opportunity; its CSS build import must remain available.

### Documentation-only finding

029 corrects dead error-component references and deleted-test coverage claims. No new broad UI suite or documentation framework is proposed. The existing ownership document already states most current boundaries and does not need a general rewrite just for using migration-era phrasing.

### Implementation and local verification

All 19 accepted findings are implemented. The frozen-source references in each finding describe the original audit evidence; references to deleted modules are historical, not missing current owners. The calendar range picker, Popover, calendar dependency, recurring-rule drag implementation, and Motion dependency are unchanged.

Production source under frontend/src and auth/better-auth/src is 830 lines smaller: 454 added and 1,284 removed across 40 files, excluding tests and audit documentation. Validation alone removes 26 lines; dialog-shell reductions were not used to disguise an expanded validator. Unused direct date-fns is removed, but transitive usage remains and no bundle saving is claimed.

Local checks passed:

- Frontend unit suite: 89 files, 691 tests on the final code. Removed tests cover only deleted years/ranges preferences; a new domain regression checks create-versus-detail account-pair validation.
- Frontend typecheck, correctness/design-system lint (zero violations), and production build.
- All 31 existing browser regressions, including Select labels, dirty-close protection, heading composition, and desktop/mobile sheet/tab geometry.
- Auth: six tests with 61 assertions, typecheck, lint of changed files, and build. Shared brand strings are identical and the module is React-free.
- All four image workflow contracts and install consistency.
- Changed TypeScript formatting and git whitespace checks. Repository-wide formatting still reports pre-existing untouched files; the baseline calendarDay source reproduces under the same formatter config. Those unrelated files were not reformatted.

Manual fixture-harness checks and recordings cover source/account/purchase tab changes, account/global transaction paging and search reset, pointer/keyboard radio selection, purchase creation and funding labels, purchase/receipt Continue and Discard with retained values, mobile navigation with Escape, and light/dark menu highlight. GIFs and screenshots are gitignored under viz/captures/shadcn-trimming with originals under ~/tmp-shots/shadcn-trimming. Busy-confirmation protection is reviewed in source; it was not exercised with a deliberately delayed in-flight request. Fractional-width/custom-font viewport boundaries are untested.

The initial safe-spending demo preset exposed a pre-existing ambiguous text locator; manual captures instead used the same fixtureapi/Vite harness commands on isolated random ports with synthetic baseline/bulk data. Hot-reload errors while files were being edited are not treated as final-code results. Final frozen-code integration and build checks pass. No production deployment verification is included in these local results.

## Historical migration audit

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
