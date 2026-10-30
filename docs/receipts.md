# Receipt evidence

Receipts attach to saved one-time expenses. Images, extraction, review drafts,
and confirmed corrections stay outside `FinancialModel`. Receipt
operations do not change financial revisions or projection identities.

## Setup and use

For a new application database, run explicit setup before the API starts:

```bash
CGO_ENABLED=0 go -C backend run ./cmd/setupdb --db /private/application.db
```

The fresh schema includes user-scoped receipts and private blob storage. Existing
databases must already have the complete current schema. Neither setup nor
runtime repairs missing tables, fields, indexes, or triggers. Schema upgrades
require separate one-time operator scripts and a verified backup with the API
stopped. A schema downgrade requires a compatible backup.

Image bytes use the private blob storage port (`backend/internal/blobstore`,
SQLite default plus filesystem adapter, lifecycle in
`backend/internal/store/adapters/sqlite/blob_storage.go`). Repeat setup preserves
receipt metadata, image bytes, and stored posting receipt links without a backfill.

Manual attachments and review need no extraction service. The ordinary deployment
default is `NET_WORTH_ESTIMATOR_RECEIPT_SOURCE=disabled`. The dev Compose stack and
isolated browser harness explicitly select `mock`. Keep normal Casdoor settings
and user permissions. No live OCR, LLM, cloud credentials, or external extraction
requests are part of this release.

1. Open a saved expense through its account's transaction list.
2. Select **Attach receipt** or **Take photo**.
3. Select **Extract details**, or enter receipt details manually.
4. Use **Save draft** to retain unfinished work.
5. Use **Confirm receipt** after review.

The transaction's receipt list marks unconfirmed corrections as **Draft saved**,
even if an earlier version was confirmed. Confirmed values show **Reviewed**.
The receipt dialog has a compact title, without status or source badges.

Use **Replace image** or **Delete receipt** below the image. Both actions require
confirmation. Replacement clears extracted values, drafts, confirmed details,
and unsaved receipt edits. A failed upload preserves the current image and its
content. Deletion removes the image and all receipt content. Neither action
changes the transaction.

The mock recognizes this synthetic sample:

`backend/internal/receipts/adapters/mock/testdata/market.png`

It produces a USD 12.34 receipt with fractional item quantities. Other images
remain valid attachments but receive unavailable-extraction recovery and manual
entry. The mock never presents sample values as analysis of an unrelated image.
Stored metadata and API responses retain simulated-source provenance after
review, reload, or a later source change. The UI omits source labels and badges.

The mock simulates a two-second OCR scan on each uncached extraction attempt.
The delay stays inside the adapter and honors cancellation. Real providers and
cached results receive no artificial delay. The UI shows a busy button and
spinner during local requests or resumed extraction, then confirms completion.
Unit tests use `mock.NewWithLatency(0)` or Go's virtual clock.

Multiple receipts can attach to one transaction. Pending and void bank rows
cannot receive attachments: pending rows are transient sync snapshots, and
void rows record authorizations that never settled. Recurrence rules and
generated occurrences cannot receive attachments; attach to a saved
transaction instead. Receipt review remains separate from unsaved
financial-account edits. Converted settled rows are owner transactions, so they
accept receipts and keep the original posting UUID. Posted charges with no
pending predecessor insert as new disabled owner rows; they accept receipts
once saved and never duplicate across repeat syncs.

## Source boundary

`backend/internal/receipts/extractor.go` owns `ReceiptExtractor`, input/result
types, and typed recovery errors. `Source` binds an immutable producer/version/
simulation descriptor to the injected adapter. The service owns validation,
concurrency, persistence, reconciliation, and user correction protection. The
adapter owns source-specific access and translation.

`ExtractionInput.ScopeID` is an internal tenant key for source policy and private
operation state. Adapters must not send it as part of a provider's receipt input.

### Extraction composition decision

Keep `ReceiptExtractor` as the image-to-structured-receipt boundary; see its
interface comment in `backend/internal/receipts/extractor.go` for the
composition constraint (no pipeline framework, no mandatory OCR stage).

### Add a source

To add a real source later:

1. Implement `ReceiptExtractor` in a new adapter package.
2. Translate results and errors into existing application types.
3. Honor context cancellation and keep provider polling inside the adapter.
4. Run `extractortest.Run` and adapter-specific error tests.
5. Register its constructor in `backend/cmd/server/receipts.go`.
6. Supply approved server-side configuration and credentials.

No receipt-service, receipt-schema, API, generated-client, or UI refactor is
required. Producer and version participate in extraction reuse, so a real source
cannot reuse a mock result. Re-extraction preserves review drafts, confirmed
corrections, and their original provenance. Original extracted values remain
available separately from reviewed values.

Live-source approval must cover region, cost, credentials, retention, and cleanup.
The mock proves workflow contracts, not OCR accuracy or provider reliability.

## HTTP and storage contract

| Endpoint | Behavior |
| --- | --- |
| `GET /v1/financial-model` | Financial model, issues, revision, and stored `receiptLinks` (posting ID to receipt IDs). |
| `GET /v1/postings/{id}/receipts` | Metadata and extraction availability. |
| `POST /v1/receipts` | Multipart `postingId` string and `image` file. No automatic extraction. |
| `GET /v1/receipts/{id}` | Extraction, drafts, confirmed values, provenance, diagnostics, revision. |
| `GET /v1/receipts/{id}/image` | Private pixels. `download=true` adds a safe attachment filename. |
| `PUT /v1/receipts/{id}/image` | Multipart `revision` and `image`. Atomically publish a new image reference and clear receipt content. |
| `POST /v1/receipts/{id}/extract` | Explicit extraction through the injected adapter. |
| `PATCH /v1/receipts/{id}` | Save `{revision, details, confirm}`. Stale revisions return 409. |
| `DELETE /v1/receipts/{id}` | Delete image and receipt data. |

Existing identity, CSRF/origin, and `Waypoint-Resource` policies apply. Mutations
require `user:write` and a writable server. Cross-user IDs return 404. Receipt
content uses `Cache-Control: private, no-store`. Images set a verified media type
and `X-Content-Type-Options: nosniff`.

The generated browser client uses the shared resource-scoped transport for
multipart uploads and Blob downloads. Preview URLs are revoked on unmount or
scope change. Receipt content never enters browser persistent storage.

- Accept JPEG and PNG inputs up to 10 MiB.
- Bound decoded images to 20 megapixels and 10,000 pixels per side.
- Apply JPEG orientation and remove metadata through pixel re-encoding.
- Reject normalized images over 3 MiB instead of silently degrading text.
- Limit each user to 100 MiB of pixels and 500 receipts.
- Deduplicate identical normalized images within one posting.
- Reject replacement images already attached as another receipt on that posting.
- Permit two active extraction calls per source, one per receipt.
- Bound extraction attempts to 45 seconds. Interrupted attachments remain saved.
- Persist failed extraction attempts as recovery state without provider secrets.

A reopened active extraction polls only receipt GET requests. A one-minute lease
separates an active attempt from an interrupted attempt. After that lease expires,
GET returns `status: interrupted` without a database write or provider request.
The user can explicitly retry or enter details manually. Extraction starts only
through POST.

Extraction can return HTTP 200 with `status: failed` and a typed `problem` because
the failed attempt was saved. A disabled source returns 503 without an attempt.
Upload and review validation errors use 422 or 413.

Image replacement rejects stale revisions with 409. It resets extraction state
and invalidates any earlier in-flight extraction result. Image reads pair saved
metadata with immutable bytes and verify the image digest and length.

Amounts use integer USD cents. Unknown values remain null. Fractional quantities
are valid. Total discrepancies and low source confidence produce diagnostics.
They never rewrite a transaction. Saved transaction changes mark earlier review
as stale.

## Lifecycle and privacy

Posting edits and reorders preserve receipts. Explicit posting deletion, CSV
replacement of postings, and clearing a user's data remove dependent receipts. The
transaction-removal confirmation explains this consequence before save.

With the default SQLite blob adapter, database backups include receipt pixels
and details. Other adapters need backups of their object storage too. Private
user refreshes copy evidence through the blob port. Public sample publication
excludes receipts entirely. Other users and application identity state remain
unchanged. Protect production backups and dev snapshots as financial records.

Deletion removes access immediately and queues durable physical cleanup. A
provider outage can delay removal of stored bytes. Cleanup retries after restart.

### Reverse lookup

Each posting row carries a stored `receipt_ids` back-reference (storage column
only; see `scanPostingRow` in `backend/internal/store/model.go` — it never
enters `FinancialModel`, financial revisions, or projection
identities). Receipt creation appends and receipt deletion removes the ID in the
same transaction as the receipt row, so the field never drifts. Posting edits
leave it untouched, posting deletion removes it with the row, and CSV
replacement resets it with the new rows.

The financial-model response exposes it as `receiptLinks`, mapping each
posting ID to its receipt IDs. The transaction list renders its receipt badge
from that map; opening a receipt still fetches full details through
`GET /v1/postings/{id}/receipts`. Receipt mutations invalidate the cached
model so badges follow attach, replace, review, extraction, and delete.

SQLite free pages, WAL files, and backups can contain deleted data. Receipt
deletion does not promise secure erasure from those locations.

## Verification

```bash
backend/scripts/verify.sh ./internal/receipts/...
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/api/...
backend/scripts/verify.sh ./internal/identity
backend/scripts/verify.sh ./cmd/refreshmodel
npm --prefix frontend test -- src/domain/receipt.test.ts src/api/waypoint-fetch.test.ts
CI=1 TEST_API_PORT=18899 TEST_FRONTEND_PORT=5187 npm --prefix frontend run test:browser -- receipts.spec.ts
NGINX_TEST_IMAGE=net-worth-frontend:main node --test scripts/nginx-receipts.test.mjs
```

Use an existing local Nginx-based image for the final check. It runs an isolated,
non-root container without network access. Do not create Docker networks during
browser tests. The normal backend and frontend completion gates still apply.
