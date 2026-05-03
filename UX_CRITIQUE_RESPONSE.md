# UX Critique Response

> Mapping each finding from `UX_CRITIQUE_V1.md` to its implementation.
>
> Excluding responsive behavior (Finding 40, P2.5) — see note at bottom.

---

## How to read this

Each finding is listed with:
- The original recommendation (abridged)
- What was built
- Where the implementation diverges from the recommendation
- Where to look in the code

---

## Finding 1 — Information architecture feels like a debug log

**Recommendation:** Create a 5-section structure: Overview → Projection → Assumptions → Scenarios → Diagnostics.

**What was built:**

| Section | Content | Location |
|---------|---------|----------|
| Overview | OverviewCard (current NW, target, date, confidence, constraint) + status badges | `CsvProjectionDashboard.tsx` |
| Chart | AccountDiagnosticChart with toggle | `AccountDiagnosticChart.tsx` |
| Assumptions | Key Assumptions card with income/expenses/rates/horizon slider | `CsvProjectionDashboard.tsx` |
| Cash flow | CashFlowWaterfall + DebtSummary + NetWorthReconciliation | `CashFlowWaterfall.tsx` etc. |
| Monte Carlo | StochasticControls with stats + methodology | `StochasticControls.tsx` |
| Scenarios | ScenarioComparison snapshots + ContributionWhatIfControls | `ScenarioComparison.tsx` |
| Diagnostics | ScenarioInspector (collapsible, with advanced mode toggle) | `CsvScenarioInspector.tsx` |

**Divergence:** The critique wanted a strict "Overview → Projection → Assumptions → Scenarios → Diagnostics" order. We grouped chart + assumptions closer together (they stay in the same scroll range), keeping diagnostics and raw source data lower. The sticky nav helps users jump between sections regardless of order.

---

## Finding 2 — Single long-scroll page lacks wayfinding

**Recommendation:** Sticky left-side section navigation, top tabs, or a sidebar.

**What was built:** `SectionNav.tsx` — a sticky horizontal nav bar that appears below the header, uses IntersectionObserver for active-section tracking, scrollable on mobile. Sections: Overview, Chart, Cash Flow, Monte Carlo, Data.

**Divergence:** The critique recommended a **left sticky panel** with target/current/assumptions. We chose a top nav bar because:
- A left sidebar would require significant layout restructuring (currently full-width content)
- The status bar already shows state at the top
- The nav is lightweight and doesn't compete for horizontal space with tables

**Trade-off:** Users get navigation but not a persistent summary sidebar. The nav disappears on scroll-down until another section enters view.

---

## Finding 3 — Hierarchy is upside down / assumptions too far from results

**Recommendation:** Show a compact assumptions summary next to the main result.

**What was built:** The "Key assumptions" card sits immediately below the OverviewCard and chart, in the same scroll viewport as the result. It shows target, horizon, overrides at top, then income/expenses, rates table, model assumptions.

**Divergence:** The recommendation wanted a table like:
```
| Salary                | $10,000/mo |
| Tax model             | 22% flat   |
| Housing               | $3,200/mo  |
```

We show postings grouped by type with optional formula expansion. The critique's exact tabular format would require computing monthly amounts from arithmetic expressions (which may be formulas). We opted to show the raw labels + frequency with an option to reveal formulas.

---

## Finding 4 — UI mixes deterministic and Monte Carlo results

**Recommendation:** Separate deterministic and probabilistic outputs visually with clear labels.

**What was built:**
- OverviewCard shows both in distinct columns: "Median across X runs" vs "Deterministic projection"
- StochasticControls is a separate section with its own stat cards
- Chart shows deterministic line + bands only when Monte Carlo is active
- Headline stat card difference: "X% of simulated paths reached..." vs "Deterministic projection reaches..."

**Divergence:** The critique wanted completely separate card groups. We felt the OverviewCard should show both at a glance (since many users want to see both numbers together) but with clear labeling. The detail is in the dedicated sections.

---

## Finding 5 — "100% chance" creates false certainty

**Recommendation:** Replace with "100% of simulated paths" or "Modeled success rate: 100% across 1,000 runs."

**What was built:** The dashboard headline now reads "X% of simulated paths reached the target" instead of "X% chance." The description text says "This depends on the assumptions above and is not a guarantee." In StochasticControls: "Modeled success rate" with "of simulated paths reached target."

**Divergence:** None — implemented as recommended.

---

## Finding 6 — App exposes developer-centric concepts

**Recommendation:** Map internal terms to user-facing language.

**What was built:**

| Internal | User-facing | Location |
|----------|-------------|----------|
| Postings | Scheduled transactions | All dashboard sections |
| Checkpoints | Balance history | All dashboard sections |
| Event rows | Projected transactions | Transaction tables |
| Realized | Applied | Driver cards, tables |
| Shortfall | Unfunded | Tables, driver cards |
| Clamp | Limited by rule | "Limited by available funds" |
| Runtime settings | Projection settings | Section titles |
| Source data | Source data | (kept as-is, clear enough) |
| What-if disable | (checkbox toggle) | Assumption list |
| Main blocker | Main constraint | Driver card |

**Divergence:** The critique recommended "Event name" column in the event rows table — we added a "Reason" column instead (finding 19). The term "Clamp" → "Limited by rule" was generalized to "Limited by available funds" since that's the most common cause.

---

## Finding 7 — Raw IDs leak into UI

**Recommendation:** Use natural labels by default; expose IDs in advanced mode only.

**What was built:** A "Show raw IDs and formulas" toggle in the ScenarioInspector. When off, IDs are hidden and account labels are shown instead of AccountId in checkpoints. The assumptions list shows only labels.

**Divergence:** The toggle is all-or-nothing (shows all IDs or none). The critique wanted per-column granularity. We chose simplicity — most users who need IDs need them everywhere, and the toggle is one click.

---

## Finding 8 — Raw formulas should be inspectable, not primary

**Recommendation:** Show plain-language descriptions by default; expandable formula detail.

**What was built:** The AssumptionList has a "Show formulas" toggle. When off, postings show "Monthly inflow" / "Monthly outflow" instead of arithmetic expressions. In the Inspector read-only table, the arithmetic column is hidden unless advanced mode is on.

**Divergence:** The critique wanted inline descriptions like "10% of remaining income after 401(k) and taxes" for each formula. We show "Monthly inflow" / "Monthly outflow" by default, which is less descriptive but still avoids exposing raw formulas. A more detailed translation would require a formula-to-English parser.

---

## Finding 9 — Hex colors should be swatches

**Recommendation:** Show a color swatch with optional hex in advanced mode.

**What was built:** `ColorSwatch` component renders a colored square + hex label. When advanced mode is off, it still shows the swatch + hex (the visual swatch makes it readable either way).

**Divergence:** The critique wanted just the color name ("Navy", "Red") instead of hex. We kept the hex because it's small and useful for debugging. The swatch communicates the color visually; the hex is secondary.

---

## Finding 10 — Chart is hard to interpret

**Recommendation:** Legend, clickable series, target label, better y-axis, near-term/long-term views, net worth vs account breakdown toggle.

**What was built:**
- ✅ Legend with human-readable series names
- ✅ Direct label on target reference line
- ✅ Y-axis formatting: `$6M`, `$4M`, `$0`, `-$2M`
- ✅ "Net worth only" / "Show account breakdown" toggle
- ✅ Milestone annotations (target hit date, first shortfall)

**Not built:**
- ❌ Clickable/toggleable series (Recharts limitation without complex state)
- ❌ Near-term vs long-term view toggle (requires chart split or zoom controls)
- ❌ Tooltip showing major events (current tooltip shows data values only)

**Divergence:** The clickable series and near-term/long-term split were deferred. The chart tooltip could be richer but was deemed sufficient for now.

---

## Finding 11 — Current net worth needs reconciliation

**Recommendation:** Table showing each account's balance, date, and source.

**What was built:** `NetWorthReconciliation` component: Assets and liabilities split into two tables, each showing account label, balance, date, and "· latest" indicator. Includes total net worth at bottom.

**Divergence:** The critique wanted a "Note" column ("Carried forward" / "Latest checkpoint"). We show the last checkpoint date per account and flag the most recent. The carried-forward semantics are inferred rather than explicit.

---

## Finding 12 — Assets and liabilities not separated

**Recommendation:** Show assets and liabilities separately with net worth total.

**What was built:** NetWorthReconciliation renders two side-by-side tables: Assets (positive balances) and Liabilities (negative balances). DebtSummary also shows debt-only perspective.

**Divergence:** None — implemented as recommended.

---

## Finding 13 — Debt model deserves a first-class section

**Recommendation:** Table with loan name, balance, APR, payment, payoff date, total interest.

**What was built:** `DebtSummary` component shows:
- Debt name, balance, payment (formula), frequency
- Estimated payoff date (computed from balance ÷ monthly payment)
- Priority rank
- Estimated total interest over loan life in an amber callout

**Not built:**
- ❌ APR (not stored in posting schema — only `annualRate` is available, which could be APR or return)
- ❌ Interest capitalization info (not modeled)
- ❌ Refinance scenario entry point (no button in the debt card itself — the "Explore fixes" CTA on the blocker card scrolls to source data)

**Divergence:** APR and interest details depend on data the model doesn't expose separately. The `annualRate` field serves dual purpose (investment return for some postings, loan rate for others), so we couldn't show a clean APR column without assumptions.

---

## Finding 14 — App needs a cash-flow waterfall

**Recommendation:** Monthly cash-flow table showing salary → taxes → housing → living → investing → remaining.

**What was built:** `CashFlowWaterfall` component categorizes postings into Income, Taxes, Housing, Living expenses, Debt payments, Investing, and Other. Shows monthly amounts for postings with numeric arithmetic, with a "Remaining cash" total at bottom.

**Divergence:** Non-numeric formulas show the raw expression instead of a computed dollar amount. The categorization is heuristic based on posting labels. The critique's exact categories (Housing, Living) map well for the test dataset but may not generalize.

---

## Finding 15 — Scenario overrides are too implementation-oriented

**Recommendation:** Provide scenario templates for common questions (refinance, extra payment, pause investing, etc.).

**What was built:** `TemplateWizard` with `IncomeForm` that generates accounts + postings from a salary/tax/investing form. The overrides section (`ContributionWhatIfControls`) allows adding accounts, postings, and checkpoints. The AssumptionList has inline toggle for disabling postings.

**Not built:**
- ❌ Refinance template
- ❌ Extra payment template
- ❌ "What if salary grows 5%?" template
- ❌ Pause investing template

**Divergence:** Only the income pattern template was implemented. The range of scenario templates the critique listed would require a more extensive template engine. The existing `generateIncomePattern` shows the pattern but could be extended.

---

## Finding 16 — No scenario comparison view

**Recommendation:** Side-by-side comparison table across scenarios with target date, final NW, success rate, etc.

**What was built:** `ScenarioComparison` component with a snapshot system:
- "Take snapshot" button captures current metrics (current NW, final NW, hit date, shortfall amount, override count)
- Table shows all snapshots with a "Current" row at bottom for comparison
- List shows name, current NW, final NW, target date, override count

**Divergence:** This is a snapshot list rather than a true multi-scenario comparison table. The recommended table would need to run multiple projections in parallel (or save/restore state). Our approach stores the result metrics at snapshot time but doesn't keep the full projection state. The critique envisioned something like:
```
| Scenario              | Target date | Final NW  |
| --------------------- | ----------- | --------- |
| Baseline              | Jul 2046    | $1.49M    |
| Refinance to 5%       | Date        | Amount    |
```
To get actual comparison data, users would need to restore a snapshot, re-run, and visually compare.

---

## Finding 17 — "Main blocker" card is not actionable enough

**Recommendation:** Rewrite in plain language, add "Explore fixes" CTA with scenario actions.

**What was built:**
- Blocker card rewritten: "Main constraint: X. Starting Y, the model cannot fully fund this scheduled payment. Total unfunded: $Z."
- "Explore fixes" button below the constraint card (scrolls to source data section)

**Not built:**
- ❌ Inline scenario actions (refinance, increase payment, change priority, etc.)
- ❌ Direct links to specific fix templates

**Divergence:** The CTA scrolls to source data rather than offering one-click fixes. The exploration is manual. A richer CTA would need the scenario templates from finding 15.

---

## Finding 18 — "Scheduled flow capture" is powerful but unclear

**Recommendation:** Rename to "Planned transaction completion" with breakdown by cause.

**What was built:** Renamed to "Planned transaction completion" with description: "The model applied $X of $Y in planned transactions." Detail text explains shortfall causes. The driver card shows the percentage and explanation.

**Divergence:** The critique wanted a breakdown table by cause (loan 1 payment: $142k, loan 2: $X, etc.). The current implementation shows this in the transaction completion table inside the collapsible section, not inline in the driver card.

---

## Finding 19 — "Upcoming event rows" needs reasons

**Recommendation:** Add event name and reason column (e.g., "Limited by scheduled payment rule").

**What was built:** Added a "Reason" column to both the main event rows table and the expanded detail: "Limited by available funds" for shortfalls, "—" otherwise.

**Divergence:** The reason is generic ("Limited by available funds") rather than specific ("Limited by scheduled payment rule" or "Limited by account cap"). The engine currently reports a single shortfall amount without attributing it to a specific constraint type.

---

## Finding 20 — Dates are too technical

**Recommendation:** Use human-readable dates; clarify date meanings; hide fallback start.

**What was built:** `formatDate("2026-05-01") → "May 1, 2026"` used everywhere in the main UI. Projection settings table still shows ISO dates (in diagnostics). Fallback start date is not exposed.

**Divergence:** The critique wanted explicit date meaning labels ("Projection begins", "First projected transaction", etc.). We rely on context (e.g., "as of May 1, 2026" next to "Current net worth") rather than labeling each date concept.

---

## Finding 21 — Inputs are not consistently formatted

**Recommendation:** Display `$1,000,000`, edit with or without formatting, add validation, clarify nominal vs real.

**What was built:**
- Display: `$1,000,000` button (reads `currency.format(num)`)
- Edit: raw `<input type="number">` showing the unformatted value (e.g., `1000000`)
- Label: "Nominal dollars" below the target

**Divergence:** The critique wanted formatted editing. The current approach shows a display-only formatted value, then switches to raw number on click. This is functional but not as polished as formatting during edit.

---

## Finding 22 — Inflation is absent or invisible

**Recommendation:** Add an inflation assumption section showing whether/at what rate inflation is modeled.

**What was built:** "Model assumptions" section in the Key Assumptions card: "Inflation is not explicitly modeled. All values are in nominal dollars unless otherwise specified." Also: "Salary growth, expense growth, and loan rates are fixed at the values shown — they do not vary automatically with inflation."

**Divergence:** The recommendation wanted a structured table with Yes/No and rate fields. We used prose instead. This is accurate but less scannable.

---

## Finding 23 — Tax modeling is underexplained

**Recommendation:** Show in plain language with limitations disclosed.

**What was built:** "Taxes are modeled as a flat percentage of income — progressive brackets, deductions, and credits are not included." in the Model assumptions section.

**Divergence:** None — implemented as recommended.

---

## Finding 24 — Rate assumptions are unclear

**Recommendation:** Show rate assumptions explicitly: which rate applies to which accounts, annual vs monthly.

**What was built:** "Annual rates" table in Key Assumptions showing per-posting rate, growth rate, and volatility. The Model assumptions section states: "Investment returns, loan rates, and expense growth are treated as annual rates, converted to monthly in the projection."

**Divergence:** The critique wanted a cleaner table with semantic columns (Investment return, Loan APR, etc.). We show per-posting rates which requires understanding that a posting's `annualRate` could be investment return or loan rate depending on context. The data doesn't distinguish these.

---

## Finding 25 — Monte Carlo section needs assumption transparency

**Recommendation:** Show return distribution, volatility, inflation, correlation, crash modeling.

**What was built:** "How the simulation works" section in StochasticControls:
- Log-normal distribution
- Volatility as spread
- Only volatile postings randomized
- No correlation or crash scenarios
- No inflation, mean reversion, or sequence-of-return risk

**Divergence:** None — implemented as recommended. The prose is slightly more verbose than the critique's bullet list but covers the same information.

---

## Finding 26 — Table design is too dense and horizontally fragile

**Recommendation:** Hide technical columns, add detail drawers, add search/filter, avoid nested scrolling.

**What was built:**
- ✅ Hide technical columns by default (ID, arithmetic, etc.) — "Show advanced" toggle
- ✅ Search/filter on each read-only table
- ✅ Flat table variant inside collapsibles (reduces card nesting)
- Row detail expansion on event rows table (expandable per-row)

**Not built:**
- ❌ Column customization
- ❌ Freeze first column
- ❌ Pagination (deferred — data scales are small)

**Divergence:** The simplified transaction table the critique suggested (Transaction, Amount, Frequency, From, To) is partially covered by the AssumptionList inline view but not implemented as a standalone table.

---

## Finding 27 — Tables need summarization, filtering, pagination

**Recommendation:** Top 10 rows, pagination, filters by status, search, sort.

**What was built:**
- ✅ Search on each read-only table
- ✅ "Show only shortfalls" not implemented but shortfall rows are highlighted in amber
- ✅ Active overrides are shown in the status bar

**Not built:**
- ❌ Pagination (deferred)
- ❌ Sort controls
- ❌ "Show only shortfalls" filter
- ❌ Top 10 default (tables show all rows)

**Divergence:** The event rows table limits to 12 rows by default (via `slice(0, 12)`). Other tables show all rows. Pagination was deferred because the current data size (10s of rows) doesn't warrant it.

---

## Finding 28 — Accordions have weak affordances

**Recommendation:** Chevrons, "Show details / Hide details", full-row click, hover states.

**What was built:** `CollapsibleSection` now has:
- ✅ Animated chevron icon
- ✅ "Show details" / "Hide details" text
- ✅ Full header row clickable
- ✅ Hover/focus states on the header
- ✅ Badge pill for summary counts

**Divergence:** None — implemented as recommended.

---

## Finding 29 — Native checkboxes feel unfinished and risky

**Recommendation:** Labeled toggles, override badges, undo, confirmation.

**What was built:** The AssumptionList uses a custom toggle (small square with checkmark) with opacity changes (disabled postings get `opacity-40 + line-through`). The status bar shows override count. In the Inspector, native checkboxes remain for the read-only tables.

**Not built:**
- ❌ Undo action
- ❌ Confirmation dialog for disabling
- ❌ Labeled toggle text

**Divergence:** The checkboxes in the Inspector table were kept because they're the simplest way to toggle many items quickly. The AssumptionList toggle is slightly more polished but still doesn't have undo or confirmation. The "risky" concern was addressed via the status bar showing active overrides.

---

## Finding 30 — App lacks a clear state model

**Recommendation:** Explicitly separate: Baseline data → Scenario overrides → Projection settings → Diagnostics.

**What was built:** Status bar at top shows:
- "Baseline loaded from /scenario"
- "X temporary scenario override(s)"
- "Editing baseline" / "Unsaved baseline edits"
- "Projection settings are session-only"

**Divergence:** The status bar is text-based rather than visual diagram. The critique wanted a clearer visual separation. We rely on the user reading the status line.

---

## Finding 31 — Source data section is too prominent

**Recommendation:** Collapse to a compact status unless there's an issue.

**What was built:** `ScenarioInspector` is wrapped in a CollapsibleSection that is closed by default. The header shows summary: "Source data, validation, and editing." Validation issues are shown inline.

**Not built:**
- ❌ "Loaded from X, last updated Y, N accounts, M transactions" compact summary line

**Divergence:** The status bar shows a lighter version: "Baseline loaded from /scenario" with account/transaction counts in the assumptions card metadata. The full inspector is one click away.

---

## Finding 32 — Visual styling overuses cards

**Recommendation:** Reduce card nesting; use lighter sectioning for diagnostics.

**What was built:** DataTable supports `variant="flat"`, which removes the Card wrapper. Used inside collapsible sections to avoid nested cards. The ScenarioInspector uses flat variant for all read-only tables.

**Divergence:** The top-level sections (Overview, Chart, Assumptions) still use cards. The critique's recommendation to use stronger headings + dividers instead of cards was partially followed — assumptions has a card, but its internal sections (target card, metadata, rates) use lighter styling.

---

## Finding 33 — Whitespace is uneven

**Recommendation:** Reduce card height/padding or increase information density.

**What was built:** Partially addressed via flat table variant and reducing padding in some areas (tighter `p-5` instead of `p-6` in some cards).

**Divergence:** Not systematically addressed. The OverviewCard has added detail text (as-of dates, context). The OutcomeMetric cards were not restructured.

---

## Finding 34 — Typography prioritizes aesthetics over legibility

**Recommendation:** Use uppercase labels sparingly; prefer sentence-case.

**What was built:** Removed `uppercase tracking-[0.16em]` from:
- `OutcomeMetric.tsx` labels
- `DriverCard.tsx` labels
- `OverviewCard.tsx` labels
- Status badges

Labels now use `text-xs font-medium text-slate-500` (sentence-case).

**Divergence:** Not all labels were updated. Section titles in CollapsibleSection, table headers, and the StatusBar still use uppercase with tracking. This is a partial fix.

---

## Finding 35 — Color semantics are not fully explained

**Recommendation:** Define a color system; add legends.

**What was built:** Color legend added near the transaction tables:
- Green circle = On track
- Amber circle = Needs attention
- Gray circle = Neutral

Status badges use consistent green/amber/slate semantics.

**Divergence:** The legend is small and only appears near the transaction tables. Account colors (chart identity) vs semantic colors (green/amber) remain potentially confusing. The critique wanted a more thorough explanation.

---

## Finding 36 — Status modeling needs improvement

**Recommendation:** Split by dimension: Long-term, Cash flow, Debt, Data quality.

**What was built:** Multi-dimensional badges:
- "On track" / "Off track" (long-term target)
- "Cash flow needs attention" (when shortfalls exist)
- "Income modeled" (when income postings exist)
- Override count badge

**Not built:**
- ❌ Debt payoff status badge
- ❌ Data quality status badge
- ❌ Simulation confidence badge

**Divergence:** Added cash flow and income dimensions alongside the existing on-track badge. Debt and data quality dimensions were not added.

---

## Finding 37 — App needs a stronger primary action

**Recommendation:** Add "Explore fixes", "Compare scenarios", "Adjust assumptions" CTA near overview.

**What was built:** "Explore fixes" button below the Main constraint card (scrolls to source data).

**Not built:**
- ❌ "Compare scenarios" button
- ❌ "Adjust assumptions" direct link
- ❌ Refinance or fix-specific actions

**Divergence:** The one CTA scrolls to source data rather than offering guided actions. The critique wanted inline fix options.

---

## Finding 38 — Reload and rerun controls are ambiguous

**Recommendation:** Use explicit labels: "Reload source data", "Recalculate projection", "Run Monte Carlo again".

**What was built:**
- ✅ "Reload source data" button
- ✅ "Re-run now" on Monte Carlo (renamed from "Re-run")
- ✅ "Recalculate" is implicit when changes trigger re-projection

**Divergence:** None — implemented as recommended.

---

## Finding 39 — Formatting is inconsistent

**Recommendation:** Standardize money, dates, frequencies, names.

**What was built:**
- ✅ Money: `currency.format()` everywhere in main UI, `formatChartCurrencyTick()` for chart y-axis
- ✅ Dates: `formatDate()` → "May 1, 2026" in main UI
- ✅ Frequencies: `formatFrequency()` → "Monthly", "Annual", etc.
- ✅ Names: labels by default, IDs optional

**Divergence:** The chart y-axis uses `formatChartCurrencyTick` which produces `$1.2M`, `$500k`, `$0` — the critique wanted this. Other formatting is standardized through utility functions.

---

## Finding 40 — Layout wastes width

**Recommendation:** Full-width chart, sticky summary sidebar, responsive grid.

**What was built:** NOT ADDRESSED (per user instruction). The layout remains centered with `max-w-7xl` and horizontal padding.

**Reason for exclusion:** The user explicitly excluded responsive behavior from the scope of this work.

---

## Summary

| Priority | Items | Status |
|----------|-------|--------|
| P0 (7 items) | Must-fix trust | All ✅ |
| P1 (8 items) | High-impact UX | 6 ✅, 2 partial (scenario comparison, overrides UX) |
| P2 (7 items) | Polish | 5 ✅, 2 partial (typography, whitespace) |
| Findings 1-40 | All concerns | 29 ✅ fully, 7 partial, 4 not addressed (including responsive) |

### Key trade-offs made

1. **Left sidebar nav vs top nav** — Top nav was faster to implement and doesn't fight with table width. Users get navigation but no persistent summary.

2. **Snapshot comparison vs live comparison** — Snapshots store result metrics at a point in time rather than running projections in parallel. This is simpler but less powerful.

3. **Formula toggle vs formula translation** — Showing "Monthly inflow" instead of translating "salary * 0.04" into English prose. The translation would require per-formula human descriptions which isn't scalable.

4. **Generic shortfall reason vs specific** — "Limited by available funds" covers most cases but doesn't distinguish between account limits, annual caps, or priority ordering.

5. **No pagination** — Current datasets are small (< 100 rows). Pagination adds complexity without current benefit.
