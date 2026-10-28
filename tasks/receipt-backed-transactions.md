# Receipt-Backed Transactions

Status: implemented with a replaceable local mock adapter. Live extraction remains deferred. See `docs/receipts.md` for the current runtime contract.

## Recommendation and assumption

Adapt HandyDollar's receipt-to-transaction workflow to Waypoint. Do not clone its application or replace Waypoint's stack.

The first release lets a household attach a receipt to an existing saved expense, inspect extracted items, and correct the receipt details. A mock adapter supplies extraction initially. Receipt evidence does not change balances, postings, forecasts, or goals.

This scope supports the evidence and provenance requirements in `PRODUCT_INTENT.md`, sections 5.6, 5.9, and 7. A general expense-management dashboard is a separate product decision.

### Dependency policy for this implementation

Use replaceable adapters for new third-party integrations. Implement a local fixture-backed receipt extractor first, behind the same contract that a real source will use later. Do not implement a live Azure/OpenAI adapter, request credentials, provision cloud resources, or make paid API calls.

Keep the browser, generated client, HTTP handlers, validation, permission checks, and SQLite persistence real. Only replace the external extraction boundary. Existing Casdoor and SimpleFIN behavior stays unchanged. Automated tests use the existing fixture identity boundary, not a new authentication bypass.

Select the adapter at server startup through constructor injection. Use the mock in dev and test fixtures. Keep extraction disabled by default for ordinary deployments. Preserve simulated provenance in the API and stored metadata, without mock-specific routes or workflow branches. The updated UI omits source badges.

## Evidence that controls the plan

| Finding | Implementation consequence |
| --- | --- |
| HandyDollar combines receipt uploads, Azure OCR, GPT parsing, and transaction presentation. Its upload code obtains public image URLs. | Reuse the workflow idea. Keep images private and simulate structured receipt extraction locally for now. |
| `backend/internal/simplefin/map.go:107-114,163-166` deliberately excludes settled transactions. Pending card postings are temporary snapshots. | Do not promise complete bank spending history or attach durable evidence to pending seeds. Keep SimpleFIN unchanged in this feature. |
| `backend/internal/types/model.go:188-245` owns postings and the projection document. | Store receipts separately. Link to the saved posting UUID, not an activity row ID or generated rule occurrence. |
| `backend/internal/store/rows.go:423-444` deletes and recreates a posting during updates. | Refactor this operation before adding receipt foreign keys. Otherwise ordinary edits can delete attachments. |
| `frontend/src/components/activity/TransactionDetail.tsx` has 1,326 lines and combines display and edit behavior. | Add only a receipt-panel composition point. Put receipt behavior in separate components and hooks. |
| `frontend/src/api/waypoint-fetch.ts` requires generated endpoints and a shared resource-scoped transport. The default mutator parses JSON. | Document multipart and binary contracts in OpenAPI. Add a binary-response mutator for private image previews. |
| `backend/internal/api/auth.go` uses an explicit write-route list. | Add every receipt mutation to the global read-only guard. Test the full permission matrix. |
| `frontend/nginx.conf.template` has no upload-size override. Nginx's documented default is `1m`. | Set an explicit bounded limit for receipt uploads and test through Nginx, not only the fixture API. |

## First-release scope

1. Open a saved expense's details and select **Attach receipt**.
2. Choose a JPEG or PNG. Offer the device camera as a progressive enhancement, with the file picker always available.
3. Save the private attachment before any extraction request.
4. Explicitly request merchant, date, currency, totals, tax, tip, and line-item extraction through the provider-neutral API.
5. Show the image beside editable receipt details. Keep extracted values distinct from user corrections.
6. Let the user enter optional item categories. Require an explicit confirmation of reviewed details.
7. Reopen the receipt after reload or server restart. Download or delete it through authorized endpoints.

Eligibility is server-checked: the target must be a saved settled transaction. Pending and void bank rows, recurrence rules, generated occurrences, and unsaved draft IDs are excluded. A vanished pending row converts to a settled owner row on a unique strict match against posted charges, and otherwise deletes with its evidence. A manual posting plus a receipt does not establish independent bank verification.

Permit multiple receipts on one posting. Each receipt belongs to one posting in this release. Receipt actions have their own save state, separate from unsaved financial-plan edits. Require the posting to be saved before attachment.

### Excluded from this release

- Plaid, Supabase, Next.js, and authentication replacements.
- A new bank transaction ledger or settled-transaction import.
- A standalone receipt inbox, automatic matching, or receipt-generated postings.
- Split payments, refunds, PDF/HEIC files, and multi-currency reporting.
- Automatic semantic item categorization, an LLM pipeline, and a general classifier framework.
- Live third-party extraction adapters, cloud provisioning, provider credentials, billing, and provider-operation polling or cleanup.
- Household spending totals inferred from an incomplete collection of attached receipts.
- Any automatic change to a posting amount, recurrence rule, or forecast.

## Architecture decision

**Classification:** new evidence subsystem, persistence change, integration, and presentation change. This is not a simulation rule change.

**Refactor decision: minor refactor first.** A major application refactor is unnecessary.

- Extract posting CRUD from the 903-line `backend/internal/store/rows.go` into a focused posting persistence file.
- Replace delete-and-insert updates with an in-place update. Preserve position, execution order, ownership, and purchase-policy replacement semantics.
- Add regression tests before receipt tables depend on posting identity.
- Keep this preparation separate from receipt behavior.

Receipt-specific schema, storage, extraction, and presentation belong in focused files. Existing central files receive registration or composition changes only. Do not redesign the router, model document, or transaction editor.

### Stable extraction boundary

Define the consumer-owned contract in `backend/internal/receipts/extractor.go` before implementing the mock:

```go
type ReceiptExtractor interface {
    Extract(ctx context.Context, input ExtractionInput) (ExtractionResult, error)
}
```

- `ExtractionInput` contains the normalized private image, media type, content digest, and stable request identity. It contains no fixture names or provider SDK types.
- `ExtractionResult` contains the application's receipt fields, item values, optional confidence, and diagnostics. It contains no provider JSON or public image URLs.
- An immutable source descriptor accompanies the injected adapter. It supplies producer ID, version, and simulated provenance. The receipt service uses it for cache identity and persisted provenance.
- Define typed application errors for unsupported input, unrecognized documents, unavailable extraction, rate limiting, timeout, invalid results, and cancellation. Include retryability and optional retry delay. Adapters translate their own failures into these errors.
- The receipt service owns validation, concurrency, extraction attempts, result persistence, reconciliation, and protection of user corrections. The adapter owns source access and conversion into application types.
- A future live adapter owns authentication, HTTP requests, response parsing, bounded polling, and any provider-private operation state. Handlers and callers still make one `Extract` call. They never perform a provider-specific sequence.
- HTTP handlers and frontend hooks depend on the receipt service's application contract. They never import adapter packages, inspect producer names, or select mock scenarios.
- Keep the interface narrow. Do not build a generic plugin platform, copy provider schemas into domain types, or add speculative cloud client implementations.

Inject the same mock implementation into normal dev wiring and isolated browser fixtures. Avoid a separate demo-only receipt service.

**Swap contract:** adding a real source requires its adapter, adapter tests, credentials/configuration, and startup wiring only. Existing receipt entities, migrations, service logic, HTTP/OpenAPI contracts, generated client, frontend hooks, and receipt components remain unchanged. If a proposed adapter requires changes to those consumers, revise the boundary before implementation.

**Agreed composition:** keep this end-to-end contract for both integrated vision
providers and an OCR-plus-interpreter adapter. Add the two internal stage
interfaces with the first composed implementation, rather than speculatively.
See the [extraction composition decision](../docs/receipts.md#extraction-composition-decision).

### State and persistence ownership

- **SQLite:** receipt metadata, private blob references, cleanup state, extraction state, extracted values, review drafts, and confirmed corrections.
- **Blob storage port:** private attachment bytes. SQLite is the default adapter. A filesystem adapter uses the same contract. Future external adapters keep provider details inside their boundary.
- **Scoped receipt store:** all persistence operations, quotas, and transactional attachment lifecycle.
- **Receipt service:** validation, extraction orchestration, reconciliation diagnostics, and concurrency control.
- **TanStack Query:** saved receipt collections, request status, and mutations. Every query key includes the verified resource scope.
- **Local React state:** unsubmitted form fields, selected files, and temporary preview URLs. Warn before discarding unsaved edits.

Keep receipt metadata independent of image storage. The default SQLite adapter
keeps images in the existing database backup. Inject storage through
`blobstore.Store`; use opaque references and durable cleanup instead of provider
types or paths in receipt logic. Keep byte reads out of model loads and receipt
lists. See `backend/internal/blobstore` and `backend/internal/store/blob_storage.go`.

Add receipt tables with composite plan/entity keys. Reference postings with `(plan_id, posting_id)`. Do not extend `FinancialModelDocument` or store receipts in the evictable `projection_artifacts` table.

**Requested ownership normalization:** derive receipt ownership from its posting
and remove the duplicate `plan_id`. The existing posting key permits identical
UUIDs across plans, and copy workflows preserve them. Enforce global posting
identity before removing the composite receipt link. Track the remaining
dependent-table cleanup in [derived plan ownership](derived-plan-ownership.md).
The user deferred the identity prerequisite and receipt cleanup together. The
current release keeps the existing composite ownership link.

Store receipt amounts as integer USD cents. Preserve missing values as unknown. Support fractional quantities. Keep confidence, producer/version, and simulated provenance with extracted values. User corrections must not overwrite the extraction record. Confirmation must not remove a mock result's simulated provenance. Item categories remain receipt-local user annotations.

Record which posting values the user reviewed. If the posting later changes, retain the receipt and flag the reconciliation as stale.

### Deletion, import, and backup contract

- Deleting a receipt removes its image, extraction, and review data in one transaction.
- Explicit posting deletion also removes attached receipts. Show that consequence before the financial deletion is saved.
- Normal posting updates and reorders preserve attachments.
- CSV replacement removes attachments for replaced postings under its documented destructive replacement contract. Require a database backup in the operator procedure.
- Plan clearing removes that plan's receipts. Other plans and identity state remain unchanged.
- Database snapshots now contain receipt images. Document this additional sensitive content for production backups and dev snapshots.
- Do not promise secure erasure from SQLite free pages, WAL files, or retained backups. Document backup retention separately.

## API and browser contract

Proposed endpoints:

| Method and path | Contract |
| --- | --- |
| `GET /v1/postings/{id}/receipts` | Receipt summaries and provider-neutral extraction availability. No image bytes or provider-mode enum. |
| `POST /v1/receipts` | Bounded multipart upload with a posting ID and image. Return the persisted attachment without running OCR. |
| `GET /v1/receipts/{id}` | Extraction, review draft, confirmed values, diagnostics, and receipt revision. |
| `GET /v1/receipts/{id}/image` | Private image or download with explicit content headers. |
| `POST /v1/receipts/{id}/extract` | Explicit, bounded extraction through the selected adapter. Return application receipt data, provenance, or a typed application error. |
| `PATCH /v1/receipts/{id}` | Save a review draft or explicitly confirm reviewed details. |
| `DELETE /v1/receipts/{id}` | Delete the attachment and its derived data. |

Use the existing identity, origin/CSRF, plan permission, and `Waypoint-Resource` boundaries. Receipt writes and extraction require `plan:write` and a writable server. Cross-plan IDs must not reveal another plan's receipt.

Use one response schema and error taxonomy for every extractor. The UI renders diagnostics without source badges. It does not branch on source names, require a sample receipt, or know which adapter is selected.

Return `Cache-Control: private, no-store` for receipt content. Set the verified image media type and `X-Content-Type-Options: nosniff`. Use a safe `Content-Disposition` filename for downloads.

Receipt review writes use an expected receipt revision. Return a conflict for stale edits. This concurrency check is receipt-specific and does not change existing financial-row write semantics.

Publish all endpoints through OpenAPI and regenerate the client. Add a resource-scoped Blob mutator in `frontend/src/api/waypoint-fetch.ts` and an operation override in `frontend/orval.config.ts`. Fetch previews through that generated endpoint, then create a temporary object URL. A direct image URL cannot supply the required resource assertion header.

Revoke preview URLs when their scope ends. Clear receipt queries and drafts on logout or resource change. Do not put image data or extracted receipt content in browser persistent storage.

## Initial adapter and extraction safety

Implement a deterministic `MockReceiptExtractor` against the stable extraction contract. Keep fixture lookup, scenario selection, and simulation behavior inside that adapter or its test harness.

Bundle synthetic JPEG/PNG receipts with matching structured fixture results. The mock may use normalized image digests for local fixture lookup. Unknown uploads remain valid private attachments. Map a missing fixture to the normal unavailable-extraction error and manual-entry recovery. Do not expose fixture-specific errors or sample-selection requirements in the application contract. Never present unrelated fixture values as an analysis of an arbitrary receipt.

- Provide deterministic fixtures for success, partial fields, low confidence, non-receipts, reconciliation mismatches, malformed output, timeout, rate limiting, and service failure.
- Select failure scenarios through injected test fixtures or explicit local-dev configuration. Do not add public request parameters that control extractor internals.
- Use controlled completion and cancellation in tests. Do not depend on real network access, random failures, or wall-clock delays.
- Persist producer identity such as `mock-receipt-v1` and an explicit simulated marker through the shared provenance contract. Keep the receipt dialog free of source labels and status badges.
- Keep all image handling on the existing private API. Do not accept arbitrary remote image URLs or send receipt content to an external service.
- Decode and validate image content server-side. Bound bytes, dimensions, decoded pixels, and per-plan storage. Apply orientation and remove unnecessary metadata before storage and transmission.
- Proposed application budgets: 10 MiB input, 20 megapixels decoded, 3 MiB normalized image, and 100 MiB stored per plan. Validate these budgets with local fixtures. They are not provider limits.
- Match Nginx's upload allowance to the API body limit plus bounded multipart overhead. Use a receipt-specific prefix location compatible with the existing `^~ /v1` location. Keep unrelated routes unchanged.
- Deduplicate exact uploads within a posting. Key extraction reuse by plan, image digest, producer ID, and producer version. A source change must not reuse a mock result as a real extraction.
- Use one active extraction per receipt and bounded total concurrency. Keep extractor execution outside database transactions.
- Use request-bound extraction with deadlines and cancellation. Interrupted requests must leave the attachment intact and expose an actionable retry state. Provider operation IDs and polling never enter the public receipt contract. The initial adapter needs neither.
- Never start extraction from a GET, render, or automatic query retry.
- Treat all extracted text as untrusted plain text. Reject malformed field shapes and flag missing currency, low confidence, and reconciliation differences.
- Compare receipt totals with item totals and the saved posting when comparable. Never force totals to match or overwrite the posting.
- Support manual receipt entry when extraction is disabled, unavailable, or inaccurate.
- Log operational counts and sanitized error codes, not images, receipt text, merchant details, or financial amounts.

### Deferred live integration

Azure Document Intelligence's `prebuilt-receipt` model remains a candidate for later integration because it returns structured receipt fields and line items. Do not implement it in this scope. Mock results establish workflow behavior, not extraction accuracy, live latency, or provider reliability.

Before a future live adapter, obtain explicit approval for provider region, credentials, billing limits, and retention. Then measure accuracy, latency, and cost with approved receipts. Azure documents a 24-hour temporary retention window and an earlier-delete API. That future adapter must address provider operation resumption, billing ambiguity, cleanup failures, and retention disclosure within the adapter boundary. These concerns must not change the receipt workflow or application contract.

## Implementation slices

| Slice | Main owners and changes | Exit condition |
| --- | --- | --- |
| 0. Stable contract and first adapter | Provider-neutral input/result/error/provenance types, extractor interface, composition wiring, adapter conformance tests, synthetic samples, and local upload budgets. | The mock satisfies the same contract as a future real source. The fixture catalog runs locally without credentials, cloud resources, or external network access. |
| 1. Persistence preparation | New posting CRUD file, `backend/internal/store/rows.go`, focused conformance tests. | In-place updates preserve identity, ordering, ownership, purchase behavior, and dependent rows. |
| 2. Secure manual receipts | New `backend/internal/types/receipt.go`, focused store/schema files, `backend/internal/api/receipt_handlers.go`, route/read-only registration, OpenAPI, scoped client hooks, `frontend/src/components/receipts/ReceiptPanel.tsx`, and Nginx upload configuration. | An owner can attach, inspect, manually describe, download, and delete a private receipt across restarts. |
| 3. Extraction workflow and review | Provider-neutral `backend/internal/receipts/` service, injected mock adapter, review editor, diagnostics, and retry. | The same service, endpoints, and components support either test adapter. Samples produce simulated evidence. Unsupported extraction allows manual entry. Failures preserve attachments and confirmed corrections. |
| 4. Release verification and operator docs | API/storage/browser tests, `TESTING.md`, `TECHNICAL_OVERVIEW.md`, backup and setup guidance. | Permission, lifecycle, migration, proxy, and forecast-invariance checks pass. |

Keep commits semantic. Obtain the required staged-diff code review before each commit. Do not bundle unrelated editor or classifier cleanup.

### Future sibling check

1. **A live receipt extractor:** implement the same extractor interface, normalize its responses/errors, run the adapter conformance suite, and change startup/configuration wiring. No receipt-service, storage-model, API, client, or UI refactor is required. Source-versioned reuse prevents mock cache collisions, and older results retain their provenance.
2. **Receipt item summaries:** query confirmed receipt metadata through the scoped receipt store. Label results as attached-receipt coverage. Do not change the simulation or create a second category cache.

A receipt inbox with suggested bank matches remains a later feature. Complete bank-backed spending analysis first needs a separate settled-transaction evidence contract. Do not silently enable settled postings in the projection model.

## Acceptance and verification

- Test two plans in one physical database with identical posting and receipt IDs. Verify metadata, image, mutation, quota, and extraction isolation.
- Test owner, guest sample, missing write permission, global read-only, stale resource assertion, and origin/CSRF failures. Rejected requests leave storage and extractor-call counts unchanged.
- Test spoofed file types, oversized bodies, decoded-image limits, unsupported formats, quota races, duplicate submissions, and concurrent extraction.
- Verify posting edits, purchase-policy changes, and reorders preserve attachments. Verify deletion, CSV replacement, clearing, backup/restore, and setup upgrade behavior explicitly.
- Verify runtime startup rejects missing receipt schema without creating or repairing it.
- Inject fixtures for malformed extractor responses, non-receipts, partial fields, fractional quantities, discounts, tax/tip mismatches, timeout, 429, service failure, and interrupted requests.
- Assert zero outbound extraction HTTP requests and zero provider credentials required. Verify the normalizer, API, SQLite, and generated browser transport remain real in end-to-end tests.
- Verify sample selection is deterministic, arbitrary uploads never receive unrelated fixture values, and stored simulated provenance survives save, confirmation, reload, and restart.
- Run a shared extractor conformance suite for normalized results, typed errors, cancellation, and source descriptors. Require every future adapter to pass it.
- Replace the mock with an independent test adapter through constructor injection. Run the same service, HTTP, persistence, and browser contract tests without consumer changes or fixture-name assumptions.
- Change producer identity/version and verify that a new extraction uses a separate cache identity. Preserve previous provenance and user corrections.
- Check that adapter imports, fixture lookup, and source selection stay outside handlers, generated client code, frontend hooks, and receipt components.
- Verify persisted review drafts survive reload. Reject stale corrections and protect confirmed values during re-extraction.
- Verify receipt upload, review, extraction, and deletion leave the financial-model revision, deterministic result, seeded stochastic result, and projection artifact identity unchanged.
- Browser-test file selection, camera fallback, preview, manual mode, extraction failure/retry, save/discard, scope changes, read-only behavior, keyboard focus, error announcements, and narrow screens.
- Test image responses through the generated binary transport. Test allowed and oversized uploads through production Nginx on disposable data.

Run the relevant narrow Go packages first, then `backend/scripts/verify.sh`, `CGO_ENABLED=0 go -C backend build ./...`, and `git diff --check`.

Run the frontend lint, typecheck, unit tests, build, and browser gate from `TESTING.md`. Regenerate OpenAPI and the client before those gates. Use local mock extraction for every extraction test. Live provider tests are out of scope. Existing local identity and fixture API servers remain part of their normal test gates.

## Rollout and remaining approvals

Release the provider-neutral receipt workflow with a mock adapter and no live integrations. Select the mock only in explicit dev/test configurations and keep ordinary deployment defaults disabled. A later real-source rollout replaces startup wiring and configuration, not the feature design. Use an explicit setup migration and a verified backup before deployment. Rollback to an older schema requires backup restoration.

The implementation uses the approved receipt-backed scope for existing expenses. A full HandyDollar-style spending application and any live extraction source require separate approval.

## Sources

- [HandyDollar README](https://github.com/the-bigbrains/HandyDollar/blob/4a0bfb860942c252e429a6de4049afd75c73f6f1/README.md)
- [HandyDollar receipt processing route](https://github.com/the-bigbrains/HandyDollar/blob/4a0bfb860942c252e429a6de4049afd75c73f6f1/src/app/api/test/route.ts)
- [HandyDollar upload implementation](https://github.com/the-bigbrains/HandyDollar/blob/4a0bfb860942c252e429a6de4049afd75c73f6f1/src/lib/upload.ts)
- [Azure receipt model and input requirements](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt?view=doc-intel-4.0.0)
- [Azure receipt field schema](https://github.com/Azure-Samples/document-intelligence-code-samples/blob/main/schema/2024-11-30-ga/receipt.md)
- [Azure data privacy and retention](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/document-intelligence/data-privacy-security)
- [Nginx upload-size directive](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)

HandyDollar is archived. Its inspected repository tree contains no license file. Treat it as a behavior reference. Confirm source reuse rights before copying any implementation.
