# Planned purchase queue

Planned purchases are standalone canonical rows in `plannedPurchases`, separate
from postings and recurrence rules. They use their own CRUD API, the shared ID
namespace, and the direct row-save workflow. Priority is nonnegative. Lower
numbers come first. Model order breaks ties.

## Authoring

Open **Planned purchases** from the navigation menu. Add a name, fixed positive cost, funding
account, and earliest purchase date. Use the arrow buttons to change priority.
Forms save each edit directly. Removals and priority changes persist immediately.
Failed saves retain form fields for retry. A multi-row priority change can persist
partially, so the queue reloads authoritative state after each attempt.

A purchase has a funding account, fixed positive cost, and earliest date. It has
no posting timestamps, amount resolver, recurrence, or occurrence claim.
Amounts cannot reference purchase IDs. This prevents
established payments from depending on optional purchases.

The earliest date sets the first eligible buy day.
Planned purchases never replay in history or execute in the main projection.
A purchase remains hypothetical until the owner removes it. The evaluation never
places orders or writes generated transactions to the database.

### Browser capture

The [purchase-capture extension](../extension/README.md) signs in as an external
device client. It saves a reviewed name, fixed USD cost, funding account and
earliest date through `POST /v1/planned-purchases`, the same API as the app.
Funding choices and queue priority come from the financial-model read. Source
details remain local to the extension.

## API

- `GET /v1/planned-purchases` reads the queue and model revision.
- `POST /v1/planned-purchases` creates a purchase. Omitted priority appends it.
- `PATCH /v1/planned-purchases/{id}` replaces purchase values. Omitted priority preserves it.
- `DELETE /v1/planned-purchases/{id}` removes a purchase.
- `POST /v1/planned-purchases/reorder` moves `{ id, beforeId }`. Empty `beforeId` appends.

Create and update return `row/issues/persisted/revision`. Delete and reorder
return the revision. All writes use the normal validation, resource guard,
permissions and read-only protection. Duplicate IDs return `409`.
The posting API rejects the retired `purchase` field instead of creating an
ordinary financial transaction from an old client payload.

## Isolated evaluation

`plannedPurchases` is a registered evaluation, like financial independence.
Its empty config `{}` selects the effective model's enabled purchase queue.
It runs a private simulation branch with the same start state, horizon, and
sampled rates as the baseline. It returns `purchases` with `purchaseId`, amounts,
and dates (null when unfunded), plus `allFunded` and `firstReachedDate`.
Stochastic results report the probability and date percentiles for full-queue
completion. Neither purchase inputs nor their priority changes affect baseline
balances, transactions, totals, scenario bands, or financial-independence results.

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
payments. Public transaction evidence and fulfillment evaluations use the same
assessment. It checks every transaction, regardless of configured evaluation
selection or enablement. It retains the
destination-ceiling distinction. Protection uses exact residual amounts, even
below the 0.5 threshold used to display public shortfall reports.
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

`planned_purchases` stores standalone rows under their owning user. Its funding
account foreign key uses that same user scope. Import, clear, private refresh,
and approved guest publication include these rows. Canonical JSON exports preserve
purchases. Model CSVs do not represent them.

The app and `setupdb` reject the retired purchase schema. Neither converts old
data. Version upgrades use a separate, one-time operator script:

```bash
# Stop the app and back up the database first. Run from the repository root.
CGO_ENABLED=0 go -C backend run ./scripts/one-time/planned-purchases --db /absolute/path/app.db
CGO_ENABLED=0 go -C backend run ./cmd/setupdb --db /absolute/path/app.db
```

The [offline deployment operation](../deploy/MIGRATIONS.md) packages this tool as
`/app/upgrade-planned-purchases`. With all API writers stopped, it takes a verified
backup, converts a candidate, checks preserved data, and publishes only the complete
current schema. Timestamp and Analysis upgrades run in that same maintenance
operation. Neither the server nor `setupdb` invokes conversion.

The script atomically converts `purchase_policies` and its posting rows for all
users. It preserves IDs, names, fixed costs, funding accounts, UTC earliest dates,
enabled state, and queue order. It removes the old posting rows and policy table.
Repeated execution does not duplicate purchases. The script has no app/store
imports and is not part of server startup or `setupdb`.

The script stops and rolls back if an old row has a variable/invalid cost, bank
ownership, a claim, attached receipts, bank links, or Analysis evidence. Resolve those rows before
retry. It never silently discards evidence. Restore the backup to undo a completed
upgrade. See [the one-time script](../backend/scripts/one-time/planned-purchases/README.md).
Old JSON payloads with posting purchase markers must convert to standalone rows
before use. The API has no backward-compatibility path.
