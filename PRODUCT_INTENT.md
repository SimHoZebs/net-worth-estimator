# Net Worth Estimator: Product Intent

This document defines the decisions, knowledge, safeguards, and outcomes the product must support. It deliberately leaves interaction structure and implementation technology open. A future design may satisfy this brief through any interaction model it can justify from the needs described here.

## 1. Product thesis

The Net Worth Estimator helps one household understand and deliberately improve its financial trajectory.

It answers:

> If we continue with the current plan, where does the base case end up, what could prevent that outcome, how uncertain is it, and which change should we inspect next?

The product turns financial records and assumptions into a defensible decision. It should help the user move from description to understanding to action without requiring the user to operate the calculation machinery or manage a spreadsheet.

A useful answer can establish:

- the current financial position;
- the base-case destination;
- the most important uncertainty;
- the first meaningful failure or constraint;
- the date and cause of a goal outcome;
- the effect of changing one planned movement;
- the evidence behind each important conclusion; and
- the next useful action.

## 2. Audience

### Primary audience: the household planner

The primary user is responsible for one household's long-term financial plan. They may be financially literate without being a professional planner. They understand balances, annual spending, dates, growth, and uncertainty but should not need specialist financial terminology to make a decision.

The planner needs to:

- maintain a coherent understanding of current and future household finances;
- understand when a goal may be reached;
- evaluate planned spending, debt payments, income, and withdrawals;
- identify the first important constraint before it becomes a crisis;
- separate near-term cash timing from longer-term plan constraints when the evidence supports it;
- test assumptions without committing them;
- understand the consequence of a change before deciding whether to keep it; and
- retain confidence that displayed values reflect the intended source data.

### Secondary audience: the plan maintainer

A plan maintainer may prepare or repair the household plan and its source data. This person needs:

- clear source and validation status;
- access to the saved plan;
- visibility into errors and incomplete information;
- safe handling of access credentials and read-only sources; and
- enough detail to repair a plan that is not producing useful outcomes.

The product's purpose remains the household's financial decision. A technically capable maintainer should not need specialist knowledge of the underlying calculation to use it safely.

### Audience assumptions to validate

The current working hypothesis is a single-household, U.S.-oriented planner and a technically capable plan maintainer. No user-research record establishes those personas yet.

The product should preserve room for a less technical household user. It should not assume a broad consumer audience until onboarding, data portability, and source setup support that audience.

## 3. Jobs to be done

The product must help the user complete these jobs:

| User question | Required response |
| --- | --- |
| Where are we now? | Current net worth, account balances, recorded-versus-modeled status, and data freshness. |
| What happens if nothing changes? | A base-case projection from the current plan through the selected horizon. |
| How uncertain is that outcome? | A median and an interpretable range across modeled scenarios when ranges are enabled. |
| Can we reach our goals? | Goal outcomes, dates, status, and uncertainty where available. |
| What fails first? | The first underfulfilled movement or goal, with its date, amount, and limiting constraint. |
| Why does it fail? | The relevant account, movement, limit, funding source, or other plan constraint. |
| What is happening soon? | Cash available, upcoming commitments, replenishment timing, and a conservative near-term spending assessment when supported by the plan. |
| What is the plan made of? | Accounts, contributions, transfers, planned income, recurring rules, one-time movements, balance checks, and goal definitions. |
| What happens if I change this? | A temporary version whose outcomes can be compared descriptively with the saved or previously captured state. |
| Can I trust this? | Clear separation of recorded facts, assumptions, planned movements, projections, ranges, goal outcomes, and inferred evidence. |
| How do I fix or verify it? | A precise path to the relevant record or assumption, followed by an explicit save or discard decision. |

## 4. Core concepts

The product must make these concepts understandable without specialist documentation.

| Concept | Meaning |
| --- | --- |
| **Recorded** | A balance or movement explicitly supplied by a source or recorded as a balance check. It is evidence of a point-in-time state, not a promise about the future. |
| **Balance check** | A recorded end-of-day account balance used to correct modeled history and establish what was known to be true at that date. |
| **Planned movement** | An expected movement into, out of, or between accounts. |
| **Account rule** | A recurring or constrained movement associated with an account. |
| **Plan** | The saved collection of accounts, movements, balance checks, assumptions, source information, and goal definitions. |
| **Temporary version** | An edited plan used for evaluation without changing the saved plan. |
| **Projection** | A calculated future path from the current plan and chosen horizon. |
| **Base case** | The projection using central assumptions without scenario variation. It is a calculation, not a prediction of what must happen. |
| **Range** | A percentile band across modeled scenarios. Its meaning must remain clear without requiring specialist terminology. |
| **Goal check** | A named question applied to a projection, such as whether a goal is reached, spending is sustainable, or planned movements are fulfilled. |
| **Financial independence** | A configurable goal check combining a minimum-net-worth gate, configured annual-expense coverage, selected funding sources, a withdrawal policy, explicitly selected continuing movements, a principal policy, and required confidence. Continuing movements are user-selected and never inferred from labels, categories, identity, or rates. |
| **Evidence analysis** | An independent inference from posting-derived external inflows, such as an estimate of posting-derived net pay. It does not independently verify bank provenance. |
| **Comparison** | A descriptive snapshot of selected measures. It does not store or restore another plan. |
| **Household timing** | Optional near-term context about cash, commitments, replenishment, and conservative room to spend. It is separate from longer-term structural constraints unless an explicit product rule combines them. |

## 5. Required product knowledge

### 5.1 Current position

The product must establish:

- current net worth;
- account-level balances and identities;
- which values are recorded, modeled, planned, or inferred;
- the balance-check and source coverage behind the baseline;
- source freshness; and
- validation problems that affect trust.

The product must not silently substitute old or bundled data when the intended source fails.

### 5.2 Base-case outcome

For a selected horizon, the product must establish:

- projection start and end dates;
- projected final net worth;
- major changes over time;
- which accounts contribute to or reduce the path;
- external inflows, external outflows, and internal transfers;
- the boundary between recorded history and modeled future; and
- important dated movements that affect the path.

The product should explain approximate or derived values rather than presenting them as exact records.

### 5.3 Uncertainty

When ranges are enabled, the product must establish:

- the scenario count;
- the median outcome;
- the selected lower and upper boundaries;
- the assumptions varied across scenarios;
- which conclusions are stable across the range; and
- which conclusions are materially uncertain.

A range represents modeled scenarios, not a guarantee. The midpoint must never be presented as the expected outcome.

### 5.4 Goal outcomes and milestones

The product must establish:

- which goal checks are configured and enabled;
- whether each goal is currently met;
- the first date associated with a goal outcome;
- milestone dates when available;
- the evidence behind each outcome; and
- any uncertainty attached to goal attainment.

The product does not assume that one goal check is always the primary verdict. Selecting a primary diagnosis remains an open product decision.

### 5.5 First material failure

The product must identify the earliest meaningful underfulfilled movement or goal and establish:

- its date;
- the requested amount;
- the realized amount;
- the relevant account or funding source;
- the binding balance, ceiling, withdrawal limit, or other constraint;
- the downstream consequence; and
- a specific way to inspect or repair the relevant plan element.

Near-term timing failures and longer-term structural constraints must remain distinguishable unless the product defines an explicit rule for combining them.

### 5.6 Causal evidence

For every material conclusion, the user must be able to determine:

- which account was involved;
- which movement, rule, balance check, assumption, or source record was involved;
- requested and realized values where applicable;
- the relevant balance, limit, or constraint;
- the event date;
- the effect on later outcomes; and
- whether the cause was planned, recorded, modeled, or inferred.

A conclusion that cannot be explained must be marked provisional or incomplete rather than presented with false confidence.

### 5.7 Plan composition and maintenance

The product must support deliberate maintenance of:

- accounts and account bounds;
- recorded one-time movements;
- scheduled and recurring rules;
- balance checks;
- planned income and income assumptions;
- transfers and external flows;
- goal and evaluation definitions;
- source ownership and read-only status; and
- validation diagnostics.

Every proposed change must be understandable before it is committed. A modified item must be reversible. A removed item must remain distinguishable from a newly added item or an exclusion.

### 5.8 Posting-derived pay evidence

Posting-derived evidence must answer a narrow question:

> What can be inferred about net pay from the one-time external inflows currently in the plan?

When evidence is available, the product must establish:

- estimated or typical net pay;
- whether annualization is justified;
- payer and cadence;
- evidence strength;
- posting-derived and comparable-record counts;
- outliers and exclusions;
- limitations; and
- the supporting and excluded movements.

Inferred net pay must never be presented as gross salary, used to silently change the plan, or shown without its evidence quality and limitations.

### 5.9 Provenance and data health

The product must distinguish:

- source- or balance-check-backed from modeled;
- saved from temporary;
- current from stale;
- validated from invalid;
- read-only from writable;
- complete from partial;
- sourced from manually entered; and
- confirmed from provisional.

Useful provenance includes:

- source identity;
- last successful load or synchronization;
- balance-check and source-record coverage;
- validation diagnostics;
- plan and income-source revision;
- calculation status; and
- evidence limitations.

Provenance must remain available whenever a user questions a material value.

## 6. Safe experimentation and comparison

The central plan lifecycle is:

```text
saved plan → temporary version → evaluated consequence → compare → save or discard
```

A temporary version must remain visibly distinct from the saved plan. Saving must be deliberate. Discarding must be explicit. Unfinished work must not be lost because the user changed context, ended a session, or encountered an error.

A comparison is useful when it answers:

> What changed in the displayed measures?

The product must establish:

- which measures are being compared;
- which state is current;
- how many unsaved changes are associated with the evaluated state;
- the horizon, source, and relevant assumptions;
- whether the compared contexts are sufficiently comparable; and
- that the comparison is descriptive rather than causal proof.

A comparison must not imply that it stores or restores an alternative plan.

## 7. Product principles

### Lead with the decision

A user should be able to identify the current position, base-case destination, major uncertainty, important risk, and next useful action without first interpreting calculation machinery.

### Preserve a path to evidence

A headline value is useful only when its basis remains understandable. Important conclusions must be inspectable to the relevant account, movement, balance check, goal definition, scenario assumption, or evidence item.

### Separate certainty from inference

The product must visibly distinguish:

- recorded balances and movements;
- source-provided or user-provided assumptions;
- planned movements;
- base-case projections;
- ranges derived from modeled scenarios;
- goal outcomes; and
- posting-derived inferences.

### Use plain outcomes and preserve depth

Primary language should describe outcomes such as “base case,” “range,” “shortfall,” “net pay,” “planned movement,” and “goal.” Specialist detail remains available when it helps the user evaluate, modify, or understand a conclusion.

Explanation should be progressive:

1. establish the conclusion;
2. provide a short reason or status;
3. reveal detailed evidence or record-level context when useful.

### Minimize interpretation effort

The product should perform as much organization, comparison, association, and contextualization as practical so the user does not need to reconstruct those relationships mentally.

The product should favor recognition over unnecessary reading, structure over repeated explanation, appropriate visualization over narration, and outcomes over internal machinery. Text remains necessary where precision, ambiguity, accessibility, or unfamiliar concepts require it.

### Make state visible

The user should never need to guess whether an outcome belongs to the saved plan, a temporary version, a previous evaluation, or a calculation still in progress.

### Optimize repeated understanding

The product should become faster to interpret as the user learns its conventions. Repeated actions and concepts should not require the user to reread instructions after every use.

### Never manufacture certainty

Exact-looking values are acceptable when their basis is known. Approximations must be labeled. Evidence quality must remain visible. A useful statement is more valuable than a precise statement with an unclear basis.

## 8. State and recovery requirements

The product must handle these states coherently regardless of interaction structure:

- loading;
- source failure;
- validation failure;
- projection failure;
- calculation updating;
- range calculation updating;
- provisional outcome;
- stale outcome;
- read-only source;
- temporary changes;
- failed save; and
- successful save.

Every material state must communicate:

- what is known;
- what is uncertain;
- whether saved data is affected;
- whether work is still running; and
- the most specific useful next action.

Recovery must be actionable rather than generic.

## 9. Accessibility and communication requirements

Any future interaction design must:

- work with keyboard input and assistive technology;
- remain understandable at different display sizes;
- avoid color as the sole carrier of meaning;
- preserve exact values in accessible form;
- provide text equivalents for spatial or visual information;
- respect reduced-motion preferences;
- maintain predictable focus and state announcements; and
- offer specific, plain-language recovery guidance.

These requirements constrain quality and inclusion. They do not prescribe a particular layout or component structure.

## 10. Boundaries and non-goals

The product is not intended to become:

- a full double-entry accounting ledger;
- a bank-connection management console;
- a tax or legal advice product;
- an automated investment or trading system;
- a collaborative advisor or client platform;
- a multi-household or institutional portfolio manager;
- a multi-currency reporting platform;
- a specialist calculation laboratory; or
- a place where multiple alternative plans are silently stored and restored.

The product should keep authoritative financial data separate from temporary versions and should not expose internal calculation machinery as the primary experience.

A source integration may support the plan-maintainer workflow, but source availability alone does not justify a general financial-operations product.

## 11. Success criteria

The product is aligned with this intent when a user can:

- state the current position, base-case future position, and most important uncertainty;
- identify the first meaningful failure and its cause;
- distinguish recorded, planned, modeled, and inferred information;
- understand whether an outcome is saved, temporary, provisional, stale, or incomplete;
- trace a material conclusion to supporting records;
- test a change safely and compare the consequence under a known context;
- distinguish near-term timing from longer-term structural constraints;
- recover from invalid data or failed calculation with a specific next step;
- inspect the evidence and limitations behind posting-derived inference; and
- complete the primary decisions with assistive technology and at different display sizes.

Feature count is not a product goal. Trustworthy understanding and deliberate action are the goals.

## 12. Open product decisions

The product does not settle the following questions:

- Is this primarily a personal planning tool, or should it support a less technical self-service audience?
- Should plan and source onboarding be part of the product experience?
- Which goal check or diagnosis should receive primary emphasis when several are configured?
- What rule, if any, should combine near-term timing constraints and longer-term structural constraints?
- How much record-level evidence should be available for posting-derived inference?
- Should temporary versions and comparisons remain temporary, or should any become durable planning records?
- Should household timing become a reusable household concept or remain a personal extension?
- How should recorded and modeled balances be distinguished when both describe the same account?
- Which approximation labels are acceptable for debt payoff and other derived dates?
- What level of scenario detail is useful without overwhelming the user?
- What future audiences, currencies, household structures, or privacy requirements should shape the product?
- Which interaction architecture best minimizes interpretation effort while preserving the product contracts above?

Until these decisions are made, the product should prefer explicit labels, conservative claims, reversible actions, and freedom from structural assumptions.
