# Transaction Categories

A transaction holds one user-facing category. This is separate from Evidence
Analysis claims: a posting may be BNPL, recurring, and a transfer at the same
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
4. Otherwise the posting stays uncategorized.

Clearing a user assignment restores the last supported bank value. Without a
supported bank value, the assignment is removed and the classifier may run
again.

## Storage

`posting_categories` is a sidecar table keyed by user and posting. It stores
`category`, `source` (`bank`, `inferred`, or `user`), `producer`, and
`updated_at`. Posting deletion cascades. Category writes never change the
financial model, the model revision, or a projection.

The table is additive. Fresh databases create it during setup. Existing
databases create it on first category read or write, the same way the
do-not-import list self-heals.

## Bank values

SimpleFIN v1 has no standard category field. `extra.category` is
provider-specific. The adapter keeps it as source evidence and maps only
supported values or common aliases onto the fixed set. An unknown value falls
through to the classifier.

SimpleFIN v2 adds structured errors and connections, not categories. The
planned merchant category code is not available from the Bridge. The sync still
uses v1.

## Asynchronous classifier

`backend/internal/categorization` owns the classifier seam. The current
implementation is a deterministic keyword mock, versioned as `keyword-v1`.

A periodic worker scans uncategorized bank postings, newest first, and writes
inferred assignments. It never blocks sync and keeps no queue table: an
interrupted run resumes from the rows on the next tick. Pending postings stay
eligible because settlement preserves the posting identity.

The worker does not classify recurrence rules. Owner-authored postings are
also skipped; the user can still assign a category to those postings through
the API.

## API and interface

`GET /v1/transactions` adds `category` and `categorySource` to each posting row.
Missing values mean uncategorized.

`PATCH /v1/postings/{id}/category` accepts `{"category": "<key>"}` or
`{"category": null}` to clear a user override. It validates the key, requires
an authenticated session on a writable server, and works on pending bank rows.
It does not replace the posting row and does not touch the financial model.

The transaction detail shows the category as one row beside the other
transaction fields. The picker lists each category with a Lucide icon and
shows a compact source icon in the row. A reset action appears when the user
set the category. The control saves immediately, so it stays separate from
the transaction form.

## Boundaries

- Recurrence rules have no category. Occurrences inherit nothing in this
  version.
- Owner-authored postings are not auto-classified.
- A CSV model import deletes and reinserts postings. The cascade drops every
  sidecar assignment, including user overrides on bank rows that the import
  preserves. Bank values return on the next sync; inferred values return when
  the worker scans again.
- The classifier does not retroactively reclassify rows after a version
  change; `producer` records the version that made the current assignment.
- An explicit "uncategorized, do not suggest" state is not implemented.
