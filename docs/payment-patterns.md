# Shared payment streams and classifications

The `payments` analysis extracts recurring external inflows and outflows once per
claimed owner snapshot. Income and rent are registry definitions over that shared
structure, not independent runners, model services, feedback tables or UI pages.
The existing analysis lifecycle avoids reevaluation when the bank input, registry
policy hash and provider revision are unchanged. A changed input currently
rebuilds the owner's streams; per-stream incremental bank updates are not implemented.

## Boundaries

- Stream identity uses owner, provider, account, currency, direction, normalized
  full description, payee, merchant metadata, memo, source category and cadence.
  Opaque bank references and display labels do not define identity. Semantic
  classification rules do not participate in identity.
- Shared cadence/amount gates preserve income behavior, including its 15 percent
  amount/interval tolerance and annual minimum of two observations. Other
  cadences require three. Settled, dated nonzero observations only; matching
  internal-transfer legs and explicit refund/reversal markers are excluded.
- Classification definitions provide ID, label, direction, supporting signals,
  candidate signals, exclusion signals and optional main-inflow ranking. New
  utilities or mortgage definitions use the same detector, provider, persistence,
  feedback and UI. Genuinely different structures need specialized generators,
  not increasingly permissive recurring-stream heuristics.
- Evidence contains domain observations and an immutable classification question.
  Model feature engineering stays private to the provider. Stream identity and
  exact question/evidence request identity remain distinct. Each classification
  has its own finding and answer, even when it shares a stream.
- Questions are batched at 100 with at most three recent original observations.
  One provider session handles all classifications and owner-scoped feedback.
  The existing deployment-wide learner shares learning, never owner bank facts
  or saved answers. Explicit negative judgments remain reviewable.
- The compact Payment patterns table shows amounts and review controls. Details
  holds the explanation, occurrence states and visibility action. No result or
  answer creates or edits a forecast schedule.

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
