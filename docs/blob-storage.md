# Private blob storage

Receipt image bytes use `blobstore.Store`, independently of receipt metadata and
OCR. SQLite remains the default adapter. A filesystem adapter also implements
the port. No S3, SeaweedFS, cloud credentials, or external requests are enabled.

## Port and adapters

`backend/internal/blobstore/store.go` defines three context-aware operations:

```go
type Store interface {
    Put(context.Context, string, io.Reader, int64) error
    Open(context.Context, string) (io.ReadCloser, error)
    Delete(context.Context, string) error
}
```

Keys are application-generated opaque identifiers. They contain no user
filenames, plan IDs, provider URLs, or authorization claims. Objects stay private.
`Put` publishes complete bytes, accepts an identical retry, and rejects different
bytes under an existing key. `Delete` is idempotent. The caller closes each reader.

- `adapters/sqlite` stores bytes in the application database's `blob_data` table.
- `adapters/filesystem` stores each object under an existing owner-only root.
  Files use mode `0600`. Object directories use mode `0700`. `os.Root` confines
  paths. Uploads publish through an atomic hard link. Deletion also removes
  abandoned temporary files for that object.

The database composition boundary accepts
`store.OpenDatabase(path, store.WithBlobStore(adapter))`. Explicit setup accepts
the same option. The caller owns the adapter's lifetime. Normal server and
offline-copy entry points still select SQLite. Filesystem selection currently
requires constructor injection, not an environment variable or automatic switch.

Implement a future S3 or SeaweedFS adapter against this port. Keep credentials,
SDK types, retries, multipart cleanup, and endpoint configuration inside its
adapter and composition wiring. Run `blobstore/storetest.Run` against it. Receipt
services, authorization, HTTP contracts, and the frontend stay unchanged.

A future statement attachment or profile image can use the same port. Its own
metadata must define authorization and lifecycle. Each independent attachment
gets a new object key. Do not share keys across unrelated owners or features.

## References and failure safety

`receipts.blob_key` references `blob_objects.key`. Receipt metadata still owns
the posting link, plan scope, media type, digest, and quota accounting. Blob keys
remain internal. Every image read checks receipt authorization before provider
access, bounds the result, and verifies its digest and length.

`blob_objects` records only an opaque key, lifecycle state, and upload lease.
It has no duplicate `plan_id`. Its states are `staged`, `live`, and `deleting`.

1. Validate the parent, revision, duplicates, and quota before upload.
2. Reserve a staged key before any provider write.
3. Upload immutable bytes with a 45-second operation timeout.
4. Publish the reference and receipt metadata in one SQLite transaction.
5. Retire unpublished objects after a failed metadata transaction.

Replacement uploads a new object before it changes the saved reference. Failed
uploads preserve the previous image and all reviewed content. Replacement clears
receipt content only when the new reference commits. Reads retain a consistent
metadata/object pair, even if replacement races with image retrieval.

Receipt deletion and replacement use database triggers to queue cleanup. Posting
deletion, plan deletion, CSV replacement, and plan clearing use the same path.
Failed physical deletion never restores deleted receipt access or loses retry
work. HTTP deletion success means new receipt requests lose access. Physical cleanup
can remain pending after a provider outage.

The server drains persisted cleanup at startup and once per minute. Abandoned
uploads become eligible after a five-minute lease. Cleanup uses the database's
tracked keys. It never scans a bucket or infers ownership from filenames.
Shutdown stops the cleanup worker before the database and adapter close.

## Setup, backup, and portability

Explicit database setup migrates earlier inline receipt images into the SQLite
adapter. It preserves receipt IDs, reviewed details, image bytes, and financial
revisions. The migration and its `receipt-blobs-v1` marker commit atomically.
Run this legacy upgrade with the default adapter before a storage transfer.
Setup rejects an alternate adapter during an inline-image upgrade instead of
publishing references to the wrong backend. Runtime never performs this migration.
Missing lifecycle triggers fail
schema validation instead of silently disabling cleanup.

With the default SQLite adapter, one SQLite-safe backup still includes image
bytes, references, and cleanup state. A filesystem deployment also needs its
object directory. External object stores need an explicit backup and retention
policy. Copy all referenced bytes with their existing keys before switching a
populated deployment's adapter. A constructor change does not move existing data.

Private plan refresh copies bytes through source and destination blob ports. It
assigns fresh object keys and commits references with the financial replacement.
Rollback retires unpublished target objects. The source stays unchanged. Public
sample publication excludes receipts and their bytes entirely. The offline
command's composition wiring must select the actual source and target adapters.

Storage abstraction does not promise secure erasure from filesystem snapshots,
SQLite free pages, WAL files, backups, or an object provider's retained versions.

## Verification

```bash
backend/scripts/verify.sh ./internal/blobstore/... ./internal/store ./cmd/refreshplan
CGO_ENABLED=1 go -C backend test -race ./internal/blobstore/... ./internal/store
CI=1 TEST_PRODUCTION=1 TEST_API_PORT=18899 TEST_FRONTEND_PORT=5187 npm --prefix frontend run test:browser -- receipts.spec.ts
```

Adapter conformance covers immutable binary round trips, idempotency, invalid
keys and lengths, reader failures, cancellation, concurrent writers, and partial
upload visibility. Receipt tests inject a separate filesystem-backed fake for
failure cases. They cover authorization before provider access, upload failure,
metadata conflicts, read/replacement races, integrity checks, cleanup retry after
restart, cross-adapter private copies, and explicit migration rollback.

### Implementation verification — 2026-10-27

Passed the full backend format/vet/test gate and Go build. Race tests passed for
both adapters, receipt storage, receipt services, the API, and private refresh.
All seven receipt browser tests passed against the production frontend and the
updated fixture API. The HTTP schema and frontend code did not change in this
storage refinement.

No S3 or SeaweedFS integration, real database migration, or deployment occurred.
Filesystem checks used private disposable directories. Existing databases still
need explicit setup before the updated API starts.
