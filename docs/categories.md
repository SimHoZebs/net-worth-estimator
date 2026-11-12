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

The table is additive. Fresh databases create it during setup. Existing
databases create it on first category read or write, the same way the
do-not-import list self-heals.

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

When `ML_JUDGMENT_URL` names a judgment endpoint and `ML_CATEGORIES=1` is
set, both mains compose a composite classifier instead: the learner
(`ml-categories-v1`) judges each direction-eligible category hypothesis and
the keyword mock backfills whatever the learner skips. A learner error falls
back to keywords for the whole batch. Without `ML_CATEGORIES=1` the worker
stays keyword-only even with a judgment endpoint configured. The learner
fills only uncategorized rows, never bank or user assignments, the same as
keywords. Each stored assignment records the producer that made it, while the
worker version names the composition.

The v1 learner is evaluation-only and deliberately conservative. Judgment
sessions open with no training feedback, so user overrides do not train the
learner yet; warm weights come from the regenerated seed. On the public
descriptor set the warm seed claims few rows (about 6%) at 0.64 confident
precision against 0.77 for keywords, so keyword stays the default. Flip the
gate only after a harness run shows warm confident precision at or above
keyword on the held-out probe.

A periodic worker scans uncategorized bank transactions, newest first, and writes
inferred assignments. It never blocks sync and keeps no queue table: an
interrupted run resumes from the rows on the next tick. Pending transactions stay
eligible because settlement preserves the transaction identity.

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
- The classifier does not retroactively reclassify rows after a version
  change; `producer` records the version that made the current assignment.
- An explicit "uncategorized, do not suggest" state is not implemented.
