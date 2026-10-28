# Planned purchase queue

Planned purchases are canonical postings with an optional `purchase: { priority }`
marker. They use the existing posting CRUD API, shared ID namespace, draft/save
workflow, artifact identity, and account movement transitions. Priority is
nonnegative. Lower numbers come first. Document order breaks ties.

## Authoring

Open **Planned purchases** from the navigation menu. Add a name, fixed positive cost, funding
account, and earliest purchase date. Use the arrow buttons to change priority.
Edits, exclusions, removals, and priority changes stay temporary until saved.

A purchase is an external outflow, with `destinations: null`, no recurrence,
and no occurrence claim. Amounts cannot reference purchase IDs. This prevents
established payments from depending on optional purchases.

The posting's transaction day is an earliest date, not a recorded purchase date.
Planned purchases never replay in history or execute in the main projection.
A purchase remains a plan until the owner removes it or changes its marker. The evaluation never
places orders or writes generated transactions to the database.

## Isolated evaluation

`plannedPurchases` is a registered evaluation, like financial independence.
Its empty config `{}` selects the effective document's enabled purchase queue.
It runs a private simulation branch with the same start state, horizon, and
sampled rates as the baseline. It returns `purchases` with posting IDs, costs,
and dates (null when unfunded), plus `allFunded` and `firstReachedDate`.
Stochastic results report the probability and date percentiles for full-queue
completion. Neither purchase inputs nor their priority changes affect baseline
balances, movements, totals, scenario bands, or financial-independence results.

The page requests this evaluation on demand through the existing projection
endpoint. It replaces the request's evaluation scope without saving an evaluation
row or rerunning FI. The query key includes both the queue and evaluation scope.

## Scheduling inside the evaluation

The backend tries whole purchases in priority order. It tries the projection
start, each established event date, and each eligible earliest-purchase date.
Established one-time postings and recurring occurrences keep their existing
order. Accepted purchases execute after both. If a checkpoint records the
projection start's end-of-day balance, purchases start on the following day.

Each attempt runs the ordinary simulation with previously accepted purchases
and the candidate purchase. It accepts the candidate only when its entire cost
is realized and no funding gap remains after that purchase through the selected
horizon. No partial purchase spends money. A blocked item holds the rest of the
queue, even when a cheaper item uses another account.

`domain.HasFundingGapFrom` exposes the reusable assessment in
`domain/funding.go` for date-window checks. The scheduler checks events after
the candidate purchase. This separates earlier same-day gaps from future
payments. Public movement evidence and fulfillment evaluations use the same
assessment. It checks every movement, regardless of configured evaluation
selection or enablement. It retains the
destination-ceiling distinction. Protection uses exact residual amounts, even
below the existing 0.5 threshold used to display public shortfall reports.
Existing earlier gaps remain visible. The queue may resume after those gaps
when replenished funds protect all later established payments.

The schedule recalculates for each sampled scenario with that scenario's rates.
Purchase candidate dates stay inside the evaluation branch. The frontend timeline shows the
base-case schedule, not a guarantee or a range of purchase dates. Unfunded items
have no invented date. A stale or failed forecast shows no current purchase date.

Financial-independence branches do not replay or schedule planned purchases.

Protection ends at the selected horizon. A longer horizon can defer a purchase
that fits under a shorter one. The scheduler is deliberately greedy and uses
full candidate simulations, not an optimizer.

## Persistence

`purchase_policies` stores the optional priority beside its owning posting.
The foreign key cascades posting deletion and replacement. Schema creation adds
the table to existing current-shape databases without changing posting columns.
Canonical JSON exports and browser drafts preserve the policy. Legacy model CSVs
do not represent it.
