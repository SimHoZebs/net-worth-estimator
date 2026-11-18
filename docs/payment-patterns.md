# Shared payment streams and classifications

The `recurring` and `payments` analyses share transaction observations and derived
statistics. Repetition
and purpose are independent assessments of that evidence. Income, rent, utility, auto insurance, and card payment are the five registry definitions in `PaymentClassifications()` (`backend/internal/analysis/payment_classifications.go`), not separate model services, feedback tables or UI pages.
The existing analysis lifecycle avoids reevaluation when the bank input, registry
policy hash and provider revision are unchanged. A changed input recomputes
only the payment streams its dirty facts touch: sync maintains the changed
fact set, a durable stream cache carries statistics and membership across runs,
and findings publish per stream with withdrawal scoped to recomputed streams.
Unchanged streams keep byte-identical findings with no new provider calls.

## Boundaries

- Stream identity uses owner, provider, account, currency, direction, normalized
  full description, payee, merchant metadata, memo and source category.
  Findings expose this cadence-independent `streamId`; purpose `patternId` also
  distinguishes the cadence cohort when repetition is established.
  Opaque bank references and display labels do not define identity. Semantic
  classification rules do not participate in identity.
  Hexadecimal references are excluded too. Bank-derived payee/merchant fragments
  are normalized only when they correlate with that source reference between
  the same descriptive prefix and ACH rail; unrelated payee properties survive.
- Shared recurrence assessment uses a 15 percent
  amount/interval tolerance and annual minimum of two observations. Other
  cadences require three. Observations must be settled, dated and nonzero.
  Repetition retains internal transfers and refunds. Purpose definitions select
  an external, non-refund evidence view; all five current definitions are
  external-only (filtered at `payment_patterns.go:177-178`).
- Classification definitions provide ID, label, direction, supporting signals,
  candidate signals, exclusion signals, optional main-inflow ranking, external-only
  eligibility and an explicit recurrence prerequisite. Repetition is not a
  universal prerequisite: explicit rent or payroll evidence can support one
  observation. Unmarked recurring inflows remain uncertain income candidates.
  Findings without established repetition omit cadence and annual estimates. New
  definitions use the same detector, provider, persistence,
  feedback and UI. Genuinely different structures need specialized generators,
  not increasingly permissive recurring-stream heuristics.
  Exclusions are exact per definition (`ExcludeSignals` in
  `payment_classifications.go:41-44`):

  | Classification | ExcludeSignals |
  | --- | --- |
  | income | — (none) |
  | rent | card-repayment, mortgage-descriptor, non-rent-charge, utility-descriptor, insurance-descriptor |
  | utility | card-repayment, mortgage-descriptor |
  | auto-insurance | card-repayment, mortgage-descriptor |
  | card-payment | mortgage-descriptor |
  Amount outliers outside a repeating cohort retain independent purpose
  assessments without borrowing that cohort's cadence or annual estimate.
- Evidence contains domain observations and an immutable classification question.
  Model feature engineering stays private to the provider. Stream identity and
  exact question/evidence request identity remain distinct. Each classification
  has its own finding and answer, even when it shares a stream.
- Request batching, sample bounds, session scope, and privacy follow
  [the provider contract](judgment-providers.md#privacy-and-replacement-requirements)
  and [the ML implementation](../ml/README.md). Explicit negative judgments
  remain reviewable.
- Pattern review shows one queue for payment purposes and repetition: Review,
  Saved, and Dismissed tabs with row counts, one row per payment stream per
  status with title, cadence plus recorded count, typical amount, and a
  suggestion chip per classification. One dialog per stream composes the
  explicit answers (Confirm plus Not) and the visibility actions. Forecast
  actions (create a new schedule or link the recorded payments to an existing
  schedule, each behind its preview) live in
  [analyses.md](analyses.md#pattern-to-new-schedule); acting on a forecast
  records confirmation in the same transaction. Confirm and Not record only
  the answer and never create or edit a schedule. Purpose and repetition keep
  separate lifecycles and explicit answers. Review uses the latest answered
  eligible occurrence, or the first eligible occurrence for an unanswered
  pattern. It saves one explicit label and never rewrites the other recorded
  answers. Withdrawn findings remain separate from current patterns.
  Source-currency amounts arrive as structured fields, never parsed from
  explanations or reconstructed from training features.

## Rent

Rent applies to external outflows. Rent wording supports it; a source rent
category or a known housing platform is an uncertain candidate. Bilt is a useful
housing signal but also supports mortgages. Exclusions follow the Boundaries
table. The
[researched platform catalog](rent-platform-evidence.md) records primary sources.
User review is the explicit answer, not a provider probability or a brand match.

## Utility

Utility applies to external outflows. Generic service wording in the
description (`utility`, `utilities`, `electric`, `electricity`, `energy`,
`water`, `gas`, `power`, `sewer`, `trash`, `waste`, `internet`, `broadband`) supports it; a resolved
utility provider without those details is an uncertain candidate. Exclusions
follow the Boundaries table.

## Auto insurance

Auto insurance applies to external outflows. Generic insurance wording
(`insurance`, `insurer`) plus a bounded set of top national carrier names
(`geico`, `progressive`, `state farm`, `allstate`, `usaa`, `liberty mutual`,
`farmers`, `nationwide`, `travelers`, `american family`, `auto insurance`,
`car insurance`) supports it; a resolved insurance provider without those
details is an uncertain candidate. Exclusions follow the Boundaries table.

## Card payment

Card payment applies to external outflows. Card repayment wording (`credit
card`, `card payment`, `card repayment`) supports it; a resolved card issuer
without those details is an uncertain candidate. Exclusions follow the
Boundaries table.

## Scale and deployment

The registry indexes by direction and filters applicable hypotheses before
provider calls. The shared learner's bucket count follows
[the ML implementation](../ml/README.md), not hundreds of separate models. A
regression exercises 300 definitions sharing one stream in three bounded
provider calls. This does not establish production capacity for hundreds of
active overlapping classifications on arbitrary transaction histories.

Provider catalogs stay out of always-loaded runtime memory. Descriptions carry
only generic service words; provider names resolve lazily per stream (dozens
per owner, never per transaction) through a resolver whose revision is
suffixed onto the analyzer version, so catalog changes invalidate freshness
through the existing version lifecycle. An empty catalog contributes no
signals. Analyzer version changes refresh findings using the existing
lifecycle.
