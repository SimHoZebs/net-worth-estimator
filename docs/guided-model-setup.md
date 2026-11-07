# Guided model setup

## Goal

Build a useful household model from familiar financial terms, without asking users
to assemble engine accounts, input bindings, and execution order themselves.
Guided setup must remain optional. Existing accounts and custom rules remain valid.
No financial advice, assumed tax rates, or inferred account relationships become
saved rules without explicit review.

## Evidence and gaps

Read-only inspection on November 7, 2026 found these patterns in the canonical
Komodo model. No personal amounts or credentials belong in this document.

| Pattern | Current support | Gap |
| --- | --- | --- |
| Payroll | Gross-pay account, fixed deductions, contribution, employer match, residual transfer | No paystub-to-plan workflow. Users must create and order related rules themselves. |
| Loan | New Loan account type creates explicit principal/interest relationship and managed rules | Periodic simple interest only. Existing pairs require a reviewed operator link. No daily accrual, capitalization, or amortization-term input. |
| Investment growth | Engine occurrence-rate provider and uncertainty | Ordinary account creation does not offer a growth assumption. Add schedule previously exposed only fixed/growing dollar amounts. |
| Automatic investing | Engine can reference another schedule's realized amount | No percentage-of-income option in Add schedule. Reference timing is not visible there. |
| Card payment | Balance reference and payment terms exist | Current balance payoff differs from statement payoff. A generic debt account and a Loan do not model all credit-card behavior. |
| RSU grant | Multiple transfer schedules and separate vested/unvested accounts | Users must construct tranche formulas, dates, and growth rules. No grant-level ownership, units, vesting, or withholding workflow. |
| Pay cadence | Daily, weekly, monthly, quarterly, annual | Biweekly and semimonthly pay need a real recurrence contract, not approximate monthly amounts. |
| Contribution caps | Annual cap per schedule | No shared cap across employers/accounts. Tax-year and catch-up rules cannot be assumed. |
| Rule maintenance | Generic schedule terms and a separate amount catalog | Calculated schedules show Varies. The first slice permits normal metadata edits without replacing their formulas. Calculation-input editing remains a gap. |

The Komodo API container reports app revision `b8bd4a967a86`, which predates the
recent loan changes. Its live schema still uses the older financial table names.
Do not treat a missing live UI feature as proof that current source lacks it.
Do not auto-link existing loan components by name.

Northflank reported a successful release for `801dc7026030`; direct readiness
returned `ok`. Vercel reported Ready, but its public `/v1/healthz` returned 503
with `no healthy upstream`. The hosted model could not be inspected through that
proxy. Deployment consistency and financial-model setup are separate concerns.
This branch changes neither production deployment.

## Recommendation

Use guided setup that compiles familiar inputs into the existing model. Do not
replace the model with a fixed household template or a second projection engine.

1. **Expose calculated schedules.** Offer percentage of another schedule,
   percentage of a live balance, annual return, and balance owed. Keep fixed and
   growing dollar amounts. Expose per-rule caps and execution priority. This is
   the first implemented slice.
2. **Make calculation inputs editable in normal schedule details.** Preserve
   unfamiliar descriptors without reconstruction. Show references, cap, cadence,
   and order. Warn about unavailable references and stale source occurrences.
3. **Add paycheck setup.** Accept net pay directly, or optional gross pay and
   user-supplied deductions. Offer retirement contribution and employer match.
   Reuse explicitly selected accounts. Review generated rows and order before
   one atomic server write. Never estimate withholding as recorded fact.
4. **Add paystub extraction as a draft.** Reuse the document-review approach.
   Extract amounts and labels with provenance. Ask users to confirm cadence,
   dates, account matches, and which items recur. Keep manual entry equivalent.
5. **Add grant setup and card setup.** Grants need explicit tranches and a clear
   distinction between share units and dollar values. Cards need statement
   closing dates and a statement-balance payment contract. A live-balance rule
   must not carry the statement-payoff label.
6. **Add broader setup suggestions.** Suggest missing growth rules or repeated
   bills from saved records. Present candidates only. Never silently convert
   history into future commitments or copy canonical household assumptions.

## Flexibility and safety

- Keep the engine as the calculation authority. Setup authors configuration only.
- Keep templates optional and composable. Allow several jobs, grants, and lenders.
- Bind references by stable ID and require explicit account matching.
- Store explicit ownership for multi-row generated setups, as Loan does today.
- Review account reuse, new accounts, formulas, dates, caps, and execution order.
- Generate multi-row setups in one validated, user-scoped transaction. Retry must
  not create duplicates. Fail the entire setup if a selected account disappears.
- Separate balance observations and recorded transactions from planned rules.
- Permit advanced edits. If edits exceed a guided form's contract, explain that
  state and retain the exact rules. Do not silently simplify them on save.
- Provide a dependency preview before removing generated rules or accounts.
- Keep jurisdictions, tax limits, currencies, and lender conventions explicit.
- Never replace a user's model with a bundled example or private canonical data.

## Architecture decision

The first slice is a presentation and integration addition. A small extraction
separates schedule terms from amount authoring. A recipe registry owns labels,
field constraints, defaults, and descriptor construction. A shared renderer owns
form presentation. The API's existing descriptor validation and Go engine remain
unchanged. No schema, browser-storage format, or persistent setup state is added.

Two sibling additions are employer match and a percentage-based savings transfer.
Both use the schedule-percentage recipe with different references and routing.
They need no new amount mode. A complete paycheck or grant setup needs its own
server-owned multi-row compiler and explicit relationship metadata, not a chain
of browser writes or a larger central amount switch.

## First-slice limits

Creation supports the new recipes. Calculation editing, payroll extraction,
multi-row generation, and full dependency ordering are not implemented.
Defaults are visible starter assumptions, not recommendations. Referenced schedules
use their latest realized amount, not a guaranteed same-date result. Users choose
an execution priority override when needed. Schedule-percentage rules default
to one priority after their selected source. Other automatic rules retain the
server's append-after-existing priority. This does not align dates or repair
existing dependencies. **Use source timing** copies the source cadence, first
date, and end date only when requested. Combined Loan balances are excluded from direct
balance-reference choices because the engine reads component accounts, not their
display total. Users retain the existing atomic Loan workflow.

Calculated schedule metadata and lifecycle actions remain available. Their literal
amount and annual-increase controls stay protected. A small change to the existing
detail guard is necessary because the former whole-row lock also prevented
renaming and removing newly generated calculated schedules. The existing partial
amend path preserves the complete descriptor during unrelated edits.
