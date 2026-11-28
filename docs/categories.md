# Transaction Categories

A transaction holds one user-facing category. This is separate from Evidence
Analysis claims: a transaction may be BNPL, recurring, and a transfer at the same
time, but it has at most one category assignment.

## Supported set

The server owns a fixed set of Plaid personal finance primary categories. The
keys live in `backend/internal/types/category.go`; there is no category
taxonomy table.

- `INCOME`
- `TRANSFER_IN`
- `TRANSFER_OUT`
- `LOAN_PAYMENTS`
- `BANK_FEES`
- `ENTERTAINMENT`
- `FOOD_AND_DRINK`
- `GENERAL_MERCHANDISE`
- `HOME_IMPROVEMENT`
- `MEDICAL`
- `PERSONAL_CARE`
- `GENERAL_SERVICES`
- `GOVERNMENT_AND_NON_PROFIT`
- `TRANSPORTATION`
- `TRAVEL`
- `RENT_AND_UTILITIES`

Bank detail is preserved in `transaction_source_facts` when the provider sends
it as a string of at most 500 characters. Object-valued or oversized `extra`
values are dropped. Only the primary key is stored and returned.

## Precedence

1. A user assignment always wins.
2. A supported bank value replaces an inferred value.
3. An inferred value fills only when no assignment exists.
4. Otherwise the transaction stays uncategorized.

Clearing a user assignment restores the last supported bank value. Without a
supported bank value, the assignment is removed and the classifier may run
again.

## Storage

`transaction_categories` is a sidecar table keyed by user and transaction. It stores
`category`, `source` (`bank`, `inferred`, or `user`), `producer`, and
`updated_at`. Transaction deletion cascades. Category writes never change the
financial model, the model revision, or a projection.

`category_evaluations` stores one explicit outcome per examined transaction:
`assigned`, `evaluated`, or `deferred`. It records the evidence fingerprint,
classifier version, attempt count, retry time, sanitized problem code, and
evaluation time. It stores no descriptors, facts, amounts, or credentials.
`category_scan_progress` stores one durable `(posted_time, transaction_id)`
keyset cursor per user. `category_feedback` is the owner-choice journal described
below.

All four category tables are additive current-schema tables. Fresh databases
create them during setup, and existing databases gain missing tables and
triggers on the first category read or write without converting rows.
Transaction and user deletion cascade to the evaluation and journal rows.
Source-facts changes and
transaction name, source, or source-account changes delete the evaluation and
any inferred assignment, while user and bank assignments keep precedence. An
explicit user assign or clear deletes the evaluation in the same sidecar
transaction.

## Bank values

SimpleFIN v2 has no standard category field. `extra.category` is
provider-specific. The adapter keeps it as source evidence and maps only
supported values or common aliases onto the fixed set. An unknown value falls
through to the classifier.

SimpleFIN v2 adds structured errors and connections, not categories. The
planned merchant category code is not available from the Bridge. The sync
uses protocol version 2 and keeps `extra.category` as provider evidence.

## Asynchronous classifier

`backend/internal/categorization` owns the classifier seam. The current
implementation is a deterministic keyword mock, versioned as `keyword-v1`.

When `ML_JUDGMENT_URL` names a judgment endpoint, both mains compose a
composite classifier: keywords answer first and the learner
(`ml-categories-v1`) backfills only what keywords skip, so the model can
add labels but never replace a keyword answer. `ML_CATEGORIES=0` forces
keyword-only. A learner provider failure defers only the skipped transactions
with the sanitized `provider_error` code; keyword assignments remain assigned.
Every classifier call returns an outcome for every input. Keyword misses and ML
no-request, uncertain, or unsupported results are terminal `evaluated` outcomes.
Pending, unavailable, malformed batches, and provider failures defer the affected
transactions with the sanitized `provider_error` code. Context cancellation
remains an error. The learner fills only eligible
uncategorized rows, never bank or user assignments, the same as keywords. Each
stored assignment records the producer that made it, while the evaluation records
the classifier composition version.

The learner previously opened judgment sessions with no training feedback, so
user overrides did not train the learner yet; warm weights came from the
regenerated seed. Matured owner labels now train through the journal below.
Measured on 282 owner-reviewed prod rows (266
emitting requests; 16 emit none and stay uncategorized) with the real
components: keyword alone labels 84 correctly with zero wrong; with
learner backfill 232 are correct with 6 new errors on rows that would
otherwise stay uncategorized. Held-out public descriptors score 0.91
confident precision on unseen merchants, so the model generalizes rather
than memorizing training rows.

A periodic worker scans eligible bank transactions in ascending
`(posted_time, transaction_id)` keyset order from the durable per-user cursor.
It processes at most one candidate batch per user per run so a large backlog
cannot starve other users. Terminal evaluations are excluded, and deferred
evaluations become eligible only when their retry time arrives. Reaching the end
wraps to the head once for that scan, which picks up backdated new rows and
explicit clears. An interrupted run resumes from the last committed cursor.

Classification happens outside the publication transaction. The worker then
re-reads current name, direction, and exact source-facts JSON, compares the
deterministic evidence fingerprint, and publishes each current outcome plus the
cursor in one short batch transaction. Stale results create neither a category
nor an evaluation, but the examined cursor still advances. Assigned outcomes use
the conditional inferred upsert and never replace user or bank rows. Deferred
attempts back off exponentially from 15 seconds to a one-hour cap; terminal
outcomes clear the retry time.

Legacy inferred assignments without an evaluation are not automatically queued.
Changed evidence removes the stale inferred assignment and evaluation so the row
can be classified again.

The worker does not classify recurrence rules. Owner-authored transactions are
also skipped; the user can still assign a category to those transactions through
the API.

## API and interface

`GET /v1/transactions` adds `category` and `categorySource` to each transaction row.
Missing values mean uncategorized.

`POST /v1/transactions/{id}/categorize` accepts `{"category": "<key>"}` or
`{"category": null}` to clear a user override. It validates the key, requires
an authenticated session on a writable server, and works on pending bank rows.
It does not replace the transaction row and does not touch the financial model.

The transaction detail shows the category as one row beside the other
transaction fields. The picker lists each category with a Lucide icon. The
source stays in the row's accessible label, and a reset action appears when
the user set the category. The control saves immediately, so it stays
separate from the transaction form.

## Boundaries

- Recurrence rules have no category. Occurrences inherit nothing in this
  version.
- Owner-authored transactions are not auto-classified.
- Model replacement deletes and reinserts transactions. The cascade drops every
  sidecar assignment, including user overrides on bank rows that the import
  preserves. Bank values return on the next sync; inferred values return when
  the worker scans again.
- Classifier or model revision changes do not requeue evaluated rows. Changed
  evidence, an explicit user clear, or a future explicit reprocess operation does;
  `producer` records the version that made the current assignment.
- An explicit "uncategorized, do not suggest" state is not implemented.

## Journal

Every owner assign and clear appends one row to `category_feedback` in the
same SQLite transaction as the sidecar write: a journal failure rolls the
sidecar write back, so the two never diverge. The row records `action`
(`assign` or `clear`), the assigned key (for a clear, the removed key, or
null when the clear removed nothing), plus a snapshot of the bank row at
review time (`name`, `direction`, `facts_json`) and `created_at` unix
seconds. The table is additive and self-heals like `transaction_categories`:
fresh databases create it during setup, and existing databases gain it through
the first journal read or write, with no migration file.
Deletes cascade exactly like the sidecar: removing a transaction or a user drops its
journal rows. Normal paths never update or delete journal rows. Bank and
inferred writes are not journaled; only owner choices train.

A full offline model refresh copies the current category sidecar, journal,
evaluations, and cursor after source facts so invalidation triggers do not erase
the copied state. A financial-only public copy keeps transaction categories but
excludes source facts, feedback, evaluations, and scan progress.

Row IDs are the zero-padded sequence (`%020d`), so lexicographic order is
sequence order.

## Quarantine and supersession

Maturation and expansion live in the journal-backed `judgment.FeedbackSource`
in the categorization package; the store stays dumb and returns rows only.
Two gates apply at `Page` time:

- Quarantine: only rows created at least 14 days ago are eligible. Fresh
  rows stop the page with the cursor held behind them, so a hasty
  correction, duplicate tap, or mislabeled row never becomes a weight before
  the owner has lived with it. Journal sequence order matches creation
  order, so unmatured rows are always the tail.
- Latest wins: only the newest row per transaction expands. Older rows are
  absorbed by advancing past them, so a changed mind never trains the label
  it replaced.

Each matured, latest row expands to one training item per request the
rebuilt serving request set emits: a confirm for the assigned kind, rejects
for every other kind. A clear expands to rejects only, since the owner
endorsed nothing. When the assigned kind emits no request (direction-gated
or signal-free), the row contributes rejects only; a clear that removed
nothing contributes nothing. The expansion rebuilds requests with
`CategoryJudgmentRequests` on the stored snapshot: deterministic, and the
same builder as serving.

Item event IDs share the row's sequence prefix as `f"{seq:020d}:{slot:02d}"`
(slot 00 is the confirm when the assigned kind emits a request; otherwise
rejects start at 00), so IDs are unique
and strictly ordered within `(after, cursor]`, and the page cursor is the
last emitted item ID. Every item carries run ID `category-feedback`.
Unmatured tail rows stop the page with the cursor behind them; superseded
rows advance the cursor past them without emitting.

No seed change ships in this chunk: the journal only records. The first
production-label promotion happens once matured volume exists.

## Delivery

`MLClassifier` carries an optional `Feedback` training source, set per tick
by the worker from the scoped store and the owner. The next per-`Classify`
session open delivers the matured journal rows and judges in the same call:
no new goroutines, no signature changes. Nil keeps the original behavior
(immediately-complete empty source), and keyword-only compositions never
implement the setter, so they never train. The source owner is
`categorization:<user>`: payment checkpoints use the bare user ID against
the same deployment-wide learner, and sharing one would interleave two
unrelated event-ID streams under one checkpoint.

## Promotion loop

Matured labels promote through the existing seed recipe, not through a live
write path:

1. Export matured journal labels (quarantined, latest-per-transaction).
2. Train a candidate model off-deployment.
3. Verify the gates (quarantine, supersession).
4. Seed swap with a backup of the replaced database, following the
   [canonical seed procedure](../ml/eval/README.md#regenerate-the-canonical-seed)
   for `ml/seed.sqlite3`; provenance is recorded in `docs/eval-datasets.md`.

The learner never writes its own seed; an operator performs the swap.

## Training gates

Two levers, never confused:

- `ML_CATEGORIES=0` forces keyword-only judging. It controls judging: the
  learner stops answering, while delivery is moot.
- `ML_TRAINING=0` pauses all matured-feedback delivery. It controls
  learning: both the payment and the category paths behave as
  immediately-complete empty sources while the gate is off. The default
  (unset or any other value) trains.

## Payment parity

`paymentFeedbackSource` enforces the same 14-day quarantine and
latest-wins per judgment request. Payment answers are single-shot
immutable, so latest-wins is a no-op safeguard; the quarantine is the
behavior change: fresh payment answers wait out the quarantine instead of
training on day zero, and the page holds its cursor behind them. Existing
learned databases keep their weights; only new feedback is gated.
