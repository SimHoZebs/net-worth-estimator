# UX Review: Financial Projection / Monte Carlo Planning App

## Purpose

This document merges two UX critiques into one actionable review for the dev team. The app appears to be a single-page financial projection and Monte Carlo simulation tool where all content is accessed by scrolling downward.

The central finding is that the product has a powerful modeling engine, but the UI currently exposes too much of the engine directly. It reads more like a developer/debug dashboard than a financial decision-making interface.

---

## Evaluation criteria

The review uses the following criteria.

### 1. Decision clarity

The user should quickly understand:

* Am I on track?
* Why or why not?
* Which assumption caused this result?
* What should I change next?

### 2. Information architecture and page flow

The page should match the user’s mental model. For this type of app, the natural flow is:

1. Current situation
2. Target and assumptions
3. Projection result
4. Risks and blockers
5. Scenario changes
6. Advanced diagnostics

### 3. Cognitive load and data presentation

Dense financial data should be progressively disclosed. The UI should summarize first, then allow inspection.

### 4. Model transparency

Because this is a projection tool, the UI must clearly distinguish:

* real data vs projected data,
* deterministic output vs Monte Carlo output,
* baseline data vs scenario overrides,
* source values vs derived values,
* assumptions vs results.

### 5. Interaction design and affordances

Editable fields, toggles, accordions, table rows, and destructive or model-changing actions should clearly look interactive and should communicate their effect.

### 6. Comparability and diagnosis

The app should help users compare scenarios, identify bottlenecks, inspect shortfalls, and understand why a number changed.

### 7. Data trustworthiness

The app should make it easy to audit current balances, projection assumptions, event ordering, and calculations.

### 8. Accessibility and responsive behavior

The interface should remain legible and usable across screen sizes, with adequate contrast, hit targets, focus states, and clear labels.

### 9. Emotional fit

The subject matter involves debt, future wealth, and financial security. The UI should be precise, calm, and honest without creating false certainty or unnecessary anxiety.

---

## Executive summary

The UI is visually clean, but structurally it is not yet user-centered. It exposes internal concepts such as postings, checkpoints, raw IDs, formulas, event rows, route utilization, and clamping. These concepts may be useful for debugging, but they should not dominate the main user experience.

The current single-page scroll design also lacks sufficient wayfinding. Because all sections are stacked vertically, the user must remember relationships between the chart, summary, assumptions, scenario overrides, postings, Monte Carlo settings, and source data while scrolling through a very long page.

The product should be reorganized around the user’s questions:

1. Where am I now?
2. Where am I going?
3. Why does the model say that?
4. What can I change?
5. Can I trust the data?

---

# Major findings

## 1. The information architecture feels like a debug log

The page reads like a model internals viewer rather than a financial planning workflow. It shows raw source tables, postings, account IDs, checkpoint rows, utilization tables, and Monte Carlo internals in the same continuous flow as user-facing results.

This makes the app feel powerful but unfinished. Users are forced to understand the implementation model before they can comfortably use the product.

### Recommendation

Create a top-level structure like this:

1. **Overview**

   * Current net worth
   * Target
   * Projected target date
   * Simulated success rate
   * Main risk or blocker

2. **Projection**

   * Net worth chart
   * Deterministic vs Monte Carlo toggle
   * Key milestones

3. **Assumptions**

   * Income
   * Taxes
   * Expenses
   * Debt
   * Investing
   * Growth/inflation

4. **Scenarios**

   * Scenario templates
   * Temporary overrides
   * Scenario comparison

5. **Diagnostics**

   * Flow capture
   * Event rows
   * Source data
   * Accounts, checkpoints, postings

Raw model internals should be moved into an **Advanced diagnostics** area.

---

## 2. The single long-scroll page lacks wayfinding

A single-page design can work, but this page has too many major sections for unassisted scrolling. Users need to move between chart, summary, assumptions, scenario changes, and raw data. Without navigation, they lose orientation.

The current page needs the user to remember where each section lives and how far away related information is.

### Recommendation

Add one of the following:

* sticky left-side section navigation,
* top tabs,
* a sticky summary sidebar,
* a table of contents,
* collapsible sections with clear hierarchy,
* or a dashboard/detail split.

A strong option for this app:

* Left sticky panel: target, current net worth, scenario selector, key assumptions.
* Main area: chart, result cards, blockers, scenario comparison, diagnostics.

---

## 3. The hierarchy is upside down or unclear

The app sometimes shows outputs before the inputs that drive them. The chart and success result are prominent, while assumptions and source rules are buried much lower. This makes the result difficult to trust.

If the page starts with results, then assumptions need to be close by, either as a sticky sidebar or an immediately adjacent panel.

### Recommendation

Near the main result, show a compact assumptions summary:

| Assumption                   |                        Value |
| ---------------------------- | ---------------------------: |
| Salary                       |                   $10,000/mo |
| Tax model                    |                     22% flat |
| Housing                      |                    $3,200/mo |
| Living expenses              |                    $2,400/mo |
| 401(k) employee contribution |                           4% |
| Employer match               | 50% of employee contribution |
| Brokerage auto-investment    |      10% of remaining income |
| Projection horizon           |                     25 years |
| Target                       |                   $1,000,000 |

Then allow the user to expand for full details.

---

## 4. The UI mixes deterministic and Monte Carlo results

The summary says the user has a “100% chance” of reaching $1,000,000 by one date, while also showing a deterministic hit date later. This appears contradictory unless the user already understands the model.

The interface mixes:

* deterministic target date,
* Monte Carlo hit probability,
* median simulated hit date,
* conservative simulated hit date,
* deterministic final net worth,
* simulated final net worth.

### Recommendation

Separate deterministic and probabilistic outputs visually.

#### Deterministic projection

* Target hit date
* Final net worth at horizon
* Surplus or deficit vs target
* Main blocker

#### Monte Carlo simulation

* Simulated success rate
* Median target date
* Conservative target date
* Final net worth range
* Number of runs
* Simulation assumptions

Use labels such as:

* **Modeled success rate:** 100% of simulated paths
* **Median simulated target date:** Nov 30, 2042
* **Deterministic target date:** Jul 30, 2046
* **Median simulated final net worth:** $2.68M
* **Deterministic final net worth:** $1.49M

---

## 5. “100% chance” creates false certainty

A Monte Carlo result showing 100% does not mean real-world certainty. It means every modeled run hit the target under the current assumptions.

The current phrasing can mislead users into thinking the outcome is guaranteed.

### Recommendation

Replace:

> 100% chance of $1,000,000

With:

> 100% of simulated paths reached $1,000,000

Or:

> Modeled success rate: 100% across 1,000 runs

Add supporting text:

> This depends on the assumptions below and is not a guarantee.

---

## 6. The app exposes developer-centric concepts too early

The app uses terms such as:

* postings,
* checkpoints,
* event rows,
* route-level utilization,
* realized vs requested,
* clamping,
* source data,
* runtime settings,
* data pack,
* fallback start date.

Some of these are valid internal concepts, but they should not dominate the primary UI.

### Recommendation

Translate internal terms into user-facing language:

| Current term     | Better user-facing term                  |
| ---------------- | ---------------------------------------- |
| Postings         | Scheduled transactions / recurring flows |
| Checkpoints      | Balance history / starting balances      |
| Event rows       | Projected transactions                   |
| Realized         | Applied                                  |
| Shortfall        | Unfunded amount                          |
| Clamp            | Limited by rule                          |
| Runtime settings | Projection settings                      |
| Source data      | Baseline data                            |
| Data pack        | Scenario file                            |
| What-if disable  | Temporarily disabled in this scenario    |

Keep the technical terms available in advanced/debug mode.

---

## 7. Raw IDs leak into the user interface

The UI shows values such as:

* `student_loan1_principal`
* `student_loan1_interest`
* `k401_employee`
* `brokerage_auto`
* `roth_ira`

These are useful database or model identifiers, but they should not be the primary user-facing labels.

### Recommendation

Use natural labels by default:

* Student Loan 1 — Principal
* Student Loan 1 — Accrued Interest
* 401(k) Employee Contribution
* Automatic Brokerage Contribution
* Roth IRA

Expose raw IDs only in an advanced column or row detail drawer.

---

## 8. Raw formulas should be inspectable, not primary

The postings table shows formulas like:

* `salary * 0.04`
* `abs(student_loan1_principal) * rate`
* `(salary - k401_employee - taxes) * 0.1`

This is useful for a developer or power user, but intimidating and noisy for a normal user.

### Recommendation

Default presentation:

> Brokerage auto-investment: 10% of remaining income after 401(k) and taxes

Expandable detail:

> Formula: `(salary - k401_employee - taxes) * 0.1`

This preserves auditability without making the table feel like a code editor.

---

## 9. Hex colors should be swatches

The accounts table displays hex codes such as `#0f172a` and `#dc2626`. Users do not need to read the underlying color value in the main UI.

### Recommendation

Show a small color swatch with an optional hex value in advanced mode.

Example:

| Account                | Chart color |
| ---------------------- | ----------- |
| Checking               | ■ Navy      |
| Student Loan Principal | ■ Red       |

---

## 10. The chart is visually clean but hard to interpret

The chart has several issues:

* multiple lines without a visible legend,
* account lines are thin and hard to distinguish,
* the target line is subtle,
* Monte Carlo bands are present but not self-explanatory,
* the y-axis uses awkward labels like `$6000k`,
* long-term growth compresses near-term debt and cash-flow behavior.

### Recommendation

Improve the chart with:

* visible legend,
* clickable/toggleable series,
* direct label on the target line,
* tooltip explaining date, net worth, assets, debts, and major event,
* better y-axis formatting: `$6M`, `$4M`, `$2M`, `$0`, `-$2M`,
* separate near-term and long-term views,
* toggle between “Net worth only” and “Account breakdown.”

---

## 11. The current net worth needs reconciliation

The summary shows a current net worth value, while checkpoint rows contain different account balances on different dates. Some balances appear to be carried forward from older checkpoints.

This creates audit friction. Users may wonder which balances were used.

### Recommendation

Add a current net worth reconciliation table:

| Component      | Balance used | As of        | Note              |
| -------------- | -----------: | ------------ | ----------------- |
| Checking       |      $23,182 | Apr 30, 2026 | Carried forward   |
| Brokerage      |         $235 | Apr 30, 2026 | Carried forward   |
| Roth IRA       |       $1,105 | Apr 30, 2026 | Carried forward   |
| Student Loan 2 |     -$10,922 | May 1, 2026  | Latest checkpoint |
| Student Loan 3 |     -$25,549 | May 1, 2026  | Latest checkpoint |

This would make the “current” number trustworthy.

---

## 12. Assets and liabilities are not separated clearly enough

Student loan principal and interest are represented as negative account balances. This is reasonable in the model but not ideal as the default UI.

### Recommendation

Show a user-facing balance summary:

#### Assets

| Account   | Balance |
| --------- | ------: |
| Checking  | $23,182 |
| Brokerage |    $235 |
| Roth IRA  |  $1,105 |
| 401(k)    |      $0 |

#### Liabilities

| Debt           |  Balance |
| -------------- | -------: |
| Student Loan 1 | -$12,901 |
| Student Loan 2 | -$12,203 |
| Student Loan 3 | -$35,502 |

#### Net worth

| Metric    |    Value |
| --------- | -------: |
| Net worth | -$24,851 |

The principal/interest split can remain available in the detailed debt view.

---

## 13. The debt model deserves a first-class section

Given the prominence of student loan accounts and shortfalls, debt should not be buried inside generic account and posting tables.

### Recommendation

Add a debt section:

| Loan           | Balance | APR | Payment | Payoff date | Total interest |
| -------------- | ------: | --: | ------: | ----------- | -------------: |
| Student Loan 1 | $12,901 |  X% | $517/mo | Date        |         Amount |
| Student Loan 2 | $12,203 |  X% | $175/mo | Date        |         Amount |
| Student Loan 3 | $35,502 |  X% |  $92/mo | Date        |         Amount |

Also show:

* interest accrued per month,
* total interest paid,
* whether interest capitalizes,
* payment priority,
* payoff order,
* refinance scenario entry point.

---

## 14. The app needs a cash-flow waterfall

The current postings table requires the user to manually reconstruct monthly cash flow.

### Recommendation

Add a simple monthly cash-flow waterfall:

| Step                                 | Monthly amount |
| ------------------------------------ | -------------: |
| Salary                               |        $10,000 |
| Taxes                                |        -$2,200 |
| Housing                              |        -$3,200 |
| Living                               |        -$2,400 |
| 401(k) employee contribution         |          -$400 |
| Student loan payments                |          -$784 |
| Remaining cash / investment capacity |         $1,016 |

This would explain the model much faster than the raw postings table.

---

## 15. Scenario overrides are too implementation-oriented

The scenario override section lets users add accounts, postings, and checkpoints. This is powerful but does not map to common financial questions.

Users are more likely to think:

* What if I refinance my loans?
* What if I pay extra toward debt?
* What if salary grows 5% per year?
* What if rent increases?
* What if I pause investing until loans are gone?
* What if I max my 401(k)?

### Recommendation

Provide scenario templates:

* Refinance loans
* Increase loan payment
* Pay minimums and invest the rest
* Pause brokerage contributions until loans are paid
* Add annual salary growth
* Increase rent or living expenses
* Max 401(k)
* Add emergency fund floor
* Add one-time expense
* Add one-time windfall

Behind the scenes, these can still create temporary postings/checkpoints/accounts.

---

## 16. There is no scenario comparison view

The app appears to show one scenario at a time. This limits decision usefulness.

### Recommendation

Add a scenario comparison table:

| Scenario                        | Target date | Final net worth | Lowest cash balance | Loan payoff date | Simulated success rate |
| ------------------------------- | ----------: | --------------: | ------------------: | ---------------: | ---------------------: |
| Baseline                        |    Jul 2046 |          $1.49M |                  $X |             Date |                   100% |
| Refinance to 5%                 |        Date |          Amount |              Amount |             Date |                Percent |
| Extra $1k/mo to loans           |        Date |          Amount |              Amount |             Date |                Percent |
| Pause investing until debt-free |        Date |          Amount |              Amount |             Date |                Percent |

This should become a core feature.

---

## 17. The “Main blocker” card is not actionable enough

The current blocker card says something like:

> Student Loan 1 Payment — $142,199 missed, first visible on 2028-05-20.

This is useful but unclear. “Missed” and “first visible” sound like internal diagnostics.

### Recommendation

Rewrite as:

> **Main constraint: Student Loan 1 payment**
>
> Starting May 20, 2028, the model cannot fully make the scheduled payment from checking. Across the projection, this creates $142,199 of unfunded scheduled payments.
>
> Suggested checks: salary after tax, housing/living expenses, payment priority, and loan strategy.

Add a CTA:

> Explore fixes

Then offer scenario actions:

* Refinance this loan
* Increase payment
* Change payment priority
* Pause brokerage auto-investing
* Reduce expenses

---

## 18. “Scheduled flow capture” is powerful but unclear

The metric says:

> 97% — $6,583,989 realized from $6,784,506 requested.

This is not self-explanatory.

Users need to know:

* What counts as requested?
* What counts as realized?
* Are investment returns included?
* Are interest charges included?
* Which flows explain the missing 3%?

### Recommendation

Rename and decompose it:

> **Planned transaction completion:** 97%
>
> The model applied $6.58M of $6.78M in planned transactions. The remaining $200.5k could not be applied because of account limits or insufficient funds.

Then show:

| Cause                     | Unfunded amount |
| ------------------------- | --------------: |
| Student Loan 1 Payment    |        $142,199 |
| Student Loan 2 Payment    |          Amount |
| Student Loan 3 Payment    |          Amount |
| Brokerage Auto-Investment |          Amount |

---

## 19. The “Upcoming event rows” table needs reasons

The upcoming event rows table shows requested, realized, and shortfall values, but the user has to infer why shortfalls exist.

### Recommendation

Add an event name and reason column:

| Date         | Event                  | Requested | Applied | Unfunded | Reason                            |
| ------------ | ---------------------- | --------: | ------: | -------: | --------------------------------- |
| May 20, 2026 | Student Loan 1 payment |      $655 |    $517 |     $138 | Limited by scheduled payment rule |
| May 21, 2026 | Student Loan 2 payment |      $293 |    $175 |     $118 | Limited by scheduled payment rule |
| May 22, 2026 | Student Loan 3 payment |      $156 |     $92 |      $64 | Limited by scheduled payment rule |

Also explain row coloring and expansion arrows.

---

## 20. Dates are too technical and inconsistent with user expectations

The UI uses ISO dates such as `2026-05-01`. That is useful for data files, but less friendly for users.

The app also shows many date concepts:

* projection start,
* fallback start,
* current date,
* next event,
* P50 hit date,
* deterministic hit date,
* horizon date,
* first visible blocker date.

### Recommendation

Use human-readable dates in the main UI:

* May 1, 2026
* Nov 30, 2042
* Jul 30, 2046

Keep ISO dates in advanced/source data mode.

Also clarify date meanings:

| Date concept                 | Meaning                               |
| ---------------------------- | ------------------------------------- |
| Projection begins            | First day modeled                     |
| Data loaded                  | When source data was last loaded      |
| First projected transaction  | Next scheduled model event            |
| Horizon ends                 | Last day of the projection            |
| Deterministic target date    | Target date under fixed assumptions   |
| Median simulated target date | Median target date across simulations |

Hide “fallback start date” unless there is missing data or diagnostic need.

---

## 21. Inputs are not consistently formatted

The target input shows `1000000`, while other areas show `$1,000,000`. This creates polish and trust issues.

### Recommendation

Format financial inputs consistently:

* Display mode: `$1,000,000`
* Edit mode: preserve helpful formatting or reformat on blur
* Add validation for invalid values
* Clarify whether values are nominal or inflation-adjusted

The target field should say one of:

* Target: $1,000,000 nominal net worth
* Target: $1,000,000 in today’s dollars

---

## 22. Inflation is absent or invisible

For a 25-year projection, inflation is critical. The UI does not clearly show whether the target and projection are nominal or real.

### Recommendation

Add an inflation assumption section:

| Setting            |                     Value |
| ------------------ | ------------------------: |
| Inflation modeled? |                    Yes/No |
| Inflation rate     |                        X% |
| Target basis       | Nominal / Today’s dollars |
| Expense growth     |               X% annually |
| Salary growth      |               X% annually |

If inflation is not modeled, explicitly say so.

---

## 23. Tax modeling is underexplained

The postings table shows taxes as `salary * 0.22`. That is likely a simplified flat tax assumption.

### Recommendation

Show it in plain language:

> Taxes are modeled as a flat 22% of salary.

Then disclose limitations:

> This does not include progressive tax brackets, payroll taxes, deductions, credits, state-specific rules, or tax treatment of investment gains unless separately modeled.

---

## 24. Rate assumptions are unclear

The postings table uses `rate`, but the UI does not clearly define it.

Questions:

* Is rate annual or monthly?
* Is it an investment return or loan APR?
* Is it shared across accounts?
* Is it converted monthly?
* Are rates different by account?

### Recommendation

Show rate assumptions explicitly:

| Rate              | Value | Applied to                  | Frequency                 |
| ----------------- | ----: | --------------------------- | ------------------------- |
| Investment return |    X% | 401(k), brokerage, Roth IRA | Annual, converted monthly |
| Loan 1 APR        |    X% | Student Loan 1              | Annual, accrues monthly   |
| Loan 2 APR        |    X% | Student Loan 2              | Annual, accrues monthly   |
| Loan 3 APR        |    X% | Student Loan 3              | Annual, accrues monthly   |

---

## 25. The Monte Carlo section needs assumption transparency

The Monte Carlo panel shows run count, seed, probability, and percentiles, but not the simulation model.

### Recommendation

Show:

* return distribution,
* volatility assumption,
* inflation assumption,
* salary/expense variability,
* tax assumptions,
* account correlation assumptions,
* whether loan rates are fixed,
* whether crashes are modeled,
* simulation frequency,
* number of runs,
* random seed.

Without this, the probability output is hard to trust.

---

## 26. Table design is too dense and horizontally fragile

Several tables overflow horizontally or require scrolling inside cards. This is especially visible in the postings table.

### Recommendation

For tables:

* hide technical columns by default,
* add column customization,
* use row detail drawers for formulas and IDs,
* freeze the first column where needed,
* add search/filter/sort,
* paginate or virtualize long lists,
* avoid nested horizontal scrolling when possible.

For user-facing recurring transactions, use a simplified table:

| Transaction            |        Amount | Frequency | From     | To             |
| ---------------------- | ------------: | --------- | -------- | -------------- |
| Salary                 |       $10,000 | Monthly   | External | Checking       |
| Taxes                  | 22% of salary | Monthly   | Checking | External       |
| Housing                |        $3,200 | Monthly   | Checking | External       |
| Student Loan 1 Payment |          $517 | Monthly   | Checking | Student Loan 1 |

---

## 27. Tables need summarization, filtering, and pagination

The raw checkpoint and event tables appear to dump data directly onto the page. This will not scale.

### Recommendation

Add:

* top 10 most relevant rows,
* pagination,
* filters by account/event/status,
* “show only shortfalls,”
* “show only active overrides,”
* search by account or transaction name,
* sort by amount/date/shortfall.

Raw tables should be inspectable, not overwhelming.

---

## 28. Accordions have weak affordances

The section controls use small text labels such as “OPEN” and “CLOSE” on the far right. They do not clearly look like buttons.

### Recommendation

Use clearer controls:

* “Show details” / “Hide details”
* chevron icons,
* clickable full header row,
* visible hover/focus states,
* consistent button styling.

Avoid placing the only control far away from the section title on very wide screens.

---

## 29. Native checkboxes feel unfinished and risky

The account/posting tables use checkboxes to immediately disable items in what-if mode. These are small controls with large model effects.

### Recommendation

Replace or augment with clearer controls:

* labeled toggles,
* temporary override badges,
* undo action,
* active changes summary,
* confirmation or warning for major changes.

Clarify whether disabling is temporary or persisted.

---

## 30. The app lacks a clear state model

The UI includes:

* source data,
* runtime settings,
* scenario overrides,
* editable target,
* reload,
* edit,
* reset overrides,
* enable/disable toggles.

It is not obvious which changes are saved, temporary, session-only, source-controlled, or derived.

### Recommendation

Explicitly separate:

1. **Baseline data** — persisted source assumptions.
2. **Scenario overrides** — temporary what-if changes.
3. **Projection settings** — session-only calculation/display settings.
4. **Diagnostics** — read-only model inspection.

Add a visible state summary:

> Baseline loaded from `/scenario`. You have 2 unsaved scenario overrides. Projection settings are session-only.

---

## 31. The source data section is too prominent

The source data section consumes significant visual space even when the data is clean.

### Recommendation

Collapse it to a compact status unless there is an issue:

> Data loaded from `/scenario`, last updated May 3, 2026. 10 accounts, 16 scheduled transactions, 14 balance checkpoints. View diagnostics.

Show the full source data cards only in diagnostics.

---

## 32. Visual styling is pleasant but overuses cards

The UI uses rounded white cards heavily. Cards appear inside cards inside cards, making every section look equally important.

### Recommendation

Reduce card nesting. Use stronger headings, dividers, and layout grouping instead of wrapping every element in another card.

Reserve cards for:

* major summary metrics,
* scenario comparison,
* important warnings,
* isolated forms.

Use lighter sectioning for raw diagnostics.

---

## 33. Whitespace is uneven

Some cards have small text floating in large containers, especially summary metric cards. This creates trapped whitespace and weakens scannability.

### Recommendation

Either:

* reduce card height/padding, or
* increase information density with supporting details, icons, trend deltas, or CTAs.

Whitespace should clarify hierarchy, not create disconnected islands.

---

## 34. Typography prioritizes aesthetics over legibility

The UI uses many small, letter-spaced uppercase labels. This looks polished but slows scanning, especially in a data-heavy financial app.

### Recommendation

Use uppercase labels sparingly. Prioritize:

* readable sentence-case labels,
* larger numeric values,
* clearer subtitles,
* stronger contrast for secondary text,
* consistent hierarchy.

---

## 35. Color semantics are not fully explained

The UI uses green, orange, yellow, gray, navy, and account-specific colors. Some colors are semantic, others are categorical.

This creates ambiguity. For example, orange rows may mean shortfall, debt, warning, or special category.

### Recommendation

Define a color system:

* Green: healthy/on track
* Yellow: needs attention
* Orange/red: shortfall or risk
* Gray: neutral/disabled/uncertain
* Account colors: chart identity only

Add legends where color carries meaning.

---

## 36. The app needs better status modeling

The UI says “On track,” but also shows payment shortfalls and a main blocker. This is not necessarily contradictory, but it needs explanation.

### Recommendation

Split status by dimension:

| Dimension             | Status               |
| --------------------- | -------------------- |
| Long-term target      | On track             |
| Near-term cash flow   | Needs attention      |
| Debt payoff           | Needs review         |
| Data quality          | Clean                |
| Simulation confidence | Assumption-dependent |

This is more honest than one global status.

---

## 37. The app needs a stronger primary action

After seeing the result, the user is not clearly guided toward a next action.

### Recommendation

Add a primary action near the overview:

* Compare scenarios
* Explore fixes
* Adjust assumptions
* Inspect main blocker
* Create scenario

For example:

> Main constraint: Student Loan 1 Payment
>
> **Explore fixes**

---

## 38. Reload and rerun controls are ambiguous

The UI includes “Reload” and “Re-run now.” It is unclear what each one does.

### Recommendation

Use explicit labels:

* Reload source data
* Recalculate projection
* Run Monte Carlo again
* Reset scenario overrides

---

## 39. Formatting is inconsistent

Observed inconsistencies:

* `$1,000,000` vs `1000000`,
* ISO dates vs natural dates,
* exact long-term dates vs rounded long-term estimates,
* raw IDs vs natural labels,
* single-letter frequency values like `m`.

### Recommendation

Standardize:

* Money: `$1,000,000` or `$1.0M` depending on context.
* Long-term projection values: rounded to sensible precision.
* Dates: human-readable in main UI, ISO in diagnostics.
* Frequencies: “Monthly,” “Annual,” “One-time,” not `m`.
* Names: natural labels by default, raw IDs in advanced mode.

---

## 40. The layout wastes width while tables still overflow

The app is centered with large margins, yet tables overflow horizontally. This suggests the layout is not using available space strategically.

### Recommendation

Use a responsive grid:

* full-width chart,
* sticky summary or assumptions sidebar,
* main detail area,
* table areas with proper column management.

Avoid narrow centered layouts for dense financial tables.

---

# Recommended product structure

## Proposed page layout

### Header

* Scenario selector
* Save status
* Reload source data
* Create scenario
* Templates

### Sticky summary/sidebar

* Current net worth
* Target
* Projection horizon
* Deterministic target date
* Simulated success rate
* Active overrides count

### Main content

#### 1. Overview

* Current net worth
* Projected final net worth
* Target date
* Main blocker
* Near-term cash-flow status

#### 2. Projection chart

* Net worth chart
* Target line
* Monte Carlo bands
* Account toggles
* Near-term / long-term toggle

#### 3. Assumptions

* Income
* Taxes
* Expenses
* Debt
* Investing
* Growth
* Inflation

#### 4. Scenario builder

* Templates
* Override summary
* Scenario comparison table

#### 5. Diagnostics

* Flow capture
* Projected event rows
* Source data
* Accounts
* Checkpoints
* Raw postings

---

# Priority matrix

## P0 — Must fix before this feels trustworthy

1. Separate deterministic and Monte Carlo outputs.
2. Replace “100% chance” with “100% of simulated paths.”
3. Add visible assumptions summary near the result.
4. Clarify state model: baseline vs override vs runtime setting.
5. Hide raw IDs/formulas from the default view.
6. Add chart legend and better y-axis formatting.
7. Explain main blocker and scheduled flow shortfalls in plain language.

## P1 — High-impact usability improvements

1. Add sticky navigation or section tabs.
2. Add scenario comparison.
3. Add cash-flow waterfall.
4. Add debt-specific section.
5. Improve accordion affordances.
6. Add table filtering/search/pagination.
7. Add current net worth reconciliation.
8. Add inflation and tax-model disclosure.

## P2 — Polish and scalability

1. Replace hex codes with swatches.
2. Improve whitespace and reduce card nesting.
3. Standardize money/date/frequency formatting.
4. Improve color semantics and legends.
5. Improve responsive behavior.
6. Add better empty/loading/error states.
7. Improve copywriting across diagnostics.

---

# Suggested copy changes

## Current

> 100% chance of $1,000,000 by 2042-11-30

## Better

> 100% of simulated paths reached $1,000,000 by Nov 30, 2042

## Current

> Deterministic: hits target on 2046-07-30. P50 final net worth: $2,680,182.

## Better

> Deterministic projection reaches the target on Jul 30, 2046. Median simulated final net worth is $2.68M.

## Current

> Main blocker: Student Loan 1 Payment. $142,199 missed, first visible on 2028-05-20.

## Better

> Main constraint: Student Loan 1 payment. Starting May 20, 2028, the model cannot fully fund this scheduled payment from checking. Total unfunded amount across the projection: $142,199.

## Current

> Scheduled Flow Capture

## Better

> Planned transaction completion

## Current

> Runtime settings and postings

## Better

> Projection settings and scheduled transactions

## Current

> Checkpoints

## Better

> Balance history

---

# Immediate dev checklist

> **Phase 1 (Trust & Clarity)** — Completed. Checked items below were implemented in the first pass.
>
> **Phase 2 (Structure & Progressive Disclosure)** — Completed. Checked items below were implemented in the second pass.

* [ ] Add a sticky section nav or tab structure.
* [x] Create a top-level overview that answers: current, target, target date, confidence, blocker.
* [x] Split deterministic and Monte Carlo result cards.
* [x] Replace "100% chance" language.
* [x] Add assumption summary next to the main result.
* [x] Add chart legend and direct target label.
* [x] Format y-axis as `$2M`, `$4M`, etc.
* [x] Replace raw target input `1000000` with formatted currency input.
* [x] Replace ISO dates with human-readable dates in the main UI.
* [x] Hide raw IDs by default.
* [x] Hide raw formulas behind expandable details.
* [x] Replace hex codes with color swatches.
* [x] Rename postings/checkpoints/event rows in user-facing sections.
* [x] Add debt summary module.
* [x] Add cash-flow waterfall.
* [x] Add current net worth reconciliation.
* [x] Add scenario templates. (Income pattern wizard already exists.)
* [ ] Add scenario comparison table.
* [x] Add table search/filter/pagination. (Search/filter added; pagination deferred until data scales.)
* [x] Clarify temporary vs saved changes.
* [x] Rename ambiguous controls: reload, rerun, reset.
* [x] Improve accordion affordances (chevrons, hover states).
* [x] Standardize frequency formatting ("Monthly" instead of "monthly").
* [x] Reduce card nesting in diagnostics (flat table variant inside collapsibles).
* [x] Add inflation and tax-model disclosure ("Model assumptions" note in assumptions card).
* [x] Add Monte Carlo assumption transparency (simulation methodology note in StochasticControls).
* [x] Add "Reason" column to upcoming event rows table (explains why shortfalls occur).
* [x] Add loading skeleton state while scenario data is being fetched.

---

# Bottom line

The product already appears to have a sophisticated simulation engine. The UI’s main problem is that it exposes that engine too directly.

The next design step is not simply visual polish. The next design step is translation: convert model internals into the user’s financial mental model.

The app should lead with:

* where the user stands,
* whether they are on track,
* why the model thinks so,
* what assumptions drive the answer,
* what action or scenario to test next,
* and where to inspect the raw data only when needed.

Right now, the interface is strongest as a developer diagnostic tool. With better hierarchy, clearer language, scenario comparison, and progressive disclosure, it can become a genuinely useful financial decision-support product.

