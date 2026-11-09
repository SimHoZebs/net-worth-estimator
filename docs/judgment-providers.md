# Judgment provider boundary

## Ownership

The application owns evidence, deterministic pattern detection, candidate
identity, financial safety, saved findings, and explicit review decisions.
The provider owns how an assessment is produced. The application never reads
model weights, probabilities, example counts, algorithms, or queue internals.

`backend/internal/judgment` declares three small ports:

- `Provider.Open(context, FeedbackSource) → Session`: prepare an implementation.
- `Session.Revision()`: an opaque token for decisions and policy freshness.
- `Evaluator.Evaluate(context, requests) → judgments`: immediate domain results
  or an immediate `pending` response for delayed work.

An income definition is composed with `analysis.NewIncome(provider)`. A new
implementation changes composition only, not the detector, API, store, or UI.
The response-only and human-queue test implementations demonstrate replacement
without any learning methods. No production LLM integration or human review
console is supplied by this change.

## Immutable evidence and decisions

An `AnalysisJudgmentInput` contains `id`, `kind`, `patternId`, `pattern`, and
`samples`. Pattern statistics are source-currency amounts, cadence, occurrence
count, variation, recency, and observed descriptor/category evidence. Up to
three recent original transaction facts provide context for automated or
human assessment. The detector does not encode model features.

`patternId` identifies the owner/account/source/currency/merchant/cadence
pattern. `id` hashes the exact request content. An asynchronous provider must
persist and deduplicate jobs by this exact request ID, never by pattern ID
alone. Changing request evidence produces a different ID. Return decisions
only for requested IDs; late or foreign responses are rejected.

Each judgment contains `requestId`, `status`, optional `strength`, and optional
`reason` (at most 2,000 bytes at the application boundary):

| Status | Strength | Application behavior |
| --- | --- | --- |
| `ready` | `strong` or `moderate` | Use this domain assessment. |
| `pending` | omitted | Preserve deterministic findings, show pending review, retry. |
| `unavailable` | omitted | Preserve deterministic findings and retry. |

Evaluation must return promptly and honor cancellation. A human queue returns
pending rather than waiting for a reviewer. The worker publishes deferred
results with a 30-second retry backoff. Providers must change their opaque
revision when policy or available decisions change, including delayed human
answers, prompt changes, and engine replacement. That triggers another run
without a bank sync. Provider decisions never become a user's saved review.

## Optional feedback

Every explicit application answer is saved first, regardless of whether the
provider consumes it. `FeedbackSource` exposes the scoped owner and ordered
pages of feedback. Each observation includes immutable `eventId`, `runId`,
`action` (`confirm` or `reject`), and the original judgment request. Other
audit actions are omitted, but the page cursor advances past them.

Providers without learning can ignore FeedbackSource entirely. A provider
that consumes it owns checkpointing and durable event deduplication. The
request path never calls the provider. Feedback delivery happens when the
background runner opens a provider session, before claiming the analysis run.

## Neutral HTTP adapter

The built-in composition reads `INCOME_JUDGMENT_URL` and uses a 5-second HTTP
timeout within the runner's 20-second context. These are bounded service calls,
not the maximum time a queued human job can remain pending. The service exposes:

1. `POST /state` with `{"owner":"scoped-store-owner"}` returns
   `{"revision":"opaque-token","cursor":"last-acknowledged-event"}`.
2. `POST /feedback` with `owner`, `after`, `cursor`, and `feedback` acknowledges
   durable delivery by returning `{"cursor":"same-cursor"}`. A non-learning
   HTTP service may acknowledge and ignore content, but must maintain its
   delivery checkpoint. In-process non-learning adapters need no checkpoints.
3. `POST /evaluate` with `{"requests":[...]}` returns `{"judgments":[...]}`.

The adapter owns state discovery, bounded 200-event pages, acknowledgement
validation, and request serialization. It namespaces opaque revisions by URL,
so changing the endpoint also invalidates findings. A service replaced at the
same URL must change its own revision. The feature never calls these transport
operations individually.

## Privacy and replacement requirements

The evidence includes sensitive original descriptions, amounts, and metadata,
not anonymous feature vectors. Keep the supplied unauthenticated service on
localhost or a private network. Configuring an external destination requires
an explicit operator decision about data handling, authentication, and retention;
this feature does not send data to any public model service by default.

A replacement must preserve request correlation, the domain result schema,
revision freshness, cancellation, and user isolation. Its own persistence,
learning, authentication, and queue implementation stay behind the adapter.
Do not add provider branches to the detector, API, store, or UI.
