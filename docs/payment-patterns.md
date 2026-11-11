# Shared payment streams and classifications

The `recurring` and `payments` analyses share transaction observations and derived
statistics. Repetition
and purpose are independent assessments of that evidence. Income and rent are
registry definitions, not separate model services, feedback tables or UI pages.
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
  Repetition retains internal transfers and refunds. Purpose definitions can
  select an external, non-refund evidence view; income and rent do so.
- Classification definitions provide ID, label, direction, supporting signals,
  candidate signals, exclusion signals, optional main-inflow ranking, external-only
  eligibility and an explicit recurrence prerequisite. Repetition is not a
  universal prerequisite: explicit rent or payroll evidence can support one
  observation. Unmarked recurring inflows remain uncertain income candidates.
  Findings without established repetition omit cadence and annual estimates. New
  utilities or mortgage definitions use the same detector, provider, persistence,
  feedback and UI. Genuinely different structures need specialized generators,
  not increasingly permissive recurring-stream heuristics.
  Amount outliers outside a repeating cohort retain independent purpose
  assessments without borrowing that cohort's cadence or annual estimate.
- Evidence contains domain observations and an immutable classification question.
  Model feature engineering stays private to the provider. Stream identity and
  exact question/evidence request identity remain distinct. Each classification
  has its own finding and answer, even when it shares a stream.
- Questions are batched at 100 with at most three recent original observations.
  One provider session handles all classifications and owner-scoped feedback.
  The existing deployment-wide learner shares learning, never owner bank facts
  or saved answers. Explicit negative judgments remain reviewable.
- Pattern review shows one queue for payment purposes and repetition: Review,
  Saved, and Dismissed tabs with row counts, one row per payment stream with
  title, cadence plus recorded count, typical amount, and a suggestion chip
  per classification. One dialog per stream composes the explicit answers
  (Confirm plus Not), the forecast actions (create a new schedule or link the
  recorded payments to an existing schedule, each behind its preview), and
  the visibility actions. Acting on a forecast records confirmation in the
  same transaction. Confirm and Not record only the answer and never create
  or edit a schedule. Purpose and repetition keep separate lifecycles and
  explicit answers.

## Rent

Rent applies to external outflows. Rent wording or a source rent category supports
it; a known housing platform without those details is uncertain. Bilt is a useful
housing signal but also supports mortgages. Card repayments, mortgage wording and
clearly non-rent property charges exclude a deterministic suggestion. The
[researched platform catalog](rent-platform-evidence.md) records primary sources.
User review is the explicit answer, not a provider probability or a brand match.

## Scale and deployment

No new service, volume, paid dependency or allocation is required. Northflank's
free-tier constraint still controls deployment. The registry indexes by direction
and filters applicable hypotheses before provider calls. The shared learner has
a fixed 8,192-bucket feature space, not hundreds of separate models. A regression
exercises 300 definitions sharing one stream in three bounded provider calls.
This does not establish production capacity for hundreds of active overlapping
classifications on arbitrary transaction histories. Broader CPU/memory/load
measurements remain a release gate before enabling such workloads.

Existing targets require the [explicit offline
upgrade](../backend/scripts/one-time/payment-patterns/README.md). There are no
runtime aliases, legacy storage readers or automatic learned-state conversions.
The independent-assessment refactor adds no database migration; analyzer version
changes refresh findings using the existing lifecycle.
