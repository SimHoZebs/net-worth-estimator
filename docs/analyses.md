# Background Analysis

An **Analysis** is a versioned inference over saved evidence. It produces
findings and explanations without changing the saved financial model. An
Evaluation answers a question about a projection instead.

## Lifecycle

SimpleFIN saves source transaction facts alongside its ordinary bank writes. It
never calls an analyzer. The independent backend worker checks durable evidence
revisions every 15 seconds, including an immediate pass at startup. Balance-only
updates and identical repeat feeds do not change that revision.

The worker claims one user-scoped run, saves its input snapshot, releases the
database transaction, and computes. It publishes findings in a separate
transaction only if the input revision still matches. Changed inputs supersede
the run. Failed analysis does not roll back sync or remove previous findings.
Expired one-minute leases permit recovery after interruption. Failed runs retry
after at least 30 seconds. Computation receives a 20-second context deadline.

`backend/internal/analysis` owns definitions and the worker. Its persistence port
is `store.AnalysisStore`. Add a definition to `analysis.Definitions()` to reuse
the lifecycle. Income-pattern and subscription detection remain future consumers.
The current worker rechecks the changed user's complete saved evidence snapshot.
It skips unchanged input revisions. It does not require a broker or external API.

## Persistence and privacy

- `transaction_source_facts` retains the full bank description, optional payee
  and memo, original decimal amount, currency, and source timestamps. Selected
  string metadata fields are allowlisted. Owner label edits do not rewrite it.
- `analysis_inputs` holds a monotonic user-scoped revision. Fact changes,
  deletion, and pending/void lifecycle changes invalidate analysis.
- `analysis_runs` records execution, producer version, input revision, and a
  private reproducible input snapshot. Retain 128 recent runs plus runs that
  findings or feedback still reference. Raw snapshots never appear in the public API.
- `analysis_findings` holds one current finding per analysis, transaction, and
  finding kind. Rechecks preserve identity, first detection, dismissal, and user review.
  Unsupported findings become withdrawn. Their original detection provenance
  stays intact. Active findings become stale when relevant evidence changes.
- `analysis_feedback` is an append-only answer history. Each event records its
  verified actor, action, original prediction, detector version, run, input revision,
  and resulting review. Referenced input snapshots survive ordinary run pruning.
  Feedback is private evidence for later evaluation, not automatic retraining.

All records belong to the existing verified user scope. Transaction deletion
removes its dependent facts, findings, and feedback. A user clear also removes runs while
retaining the monotonic input revision. CSV replacement preserves evidence for
bank rows that the import contract preserves. Other users remain untouched.
Private refreshes copy evidence. Financial-only sample publication excludes it.
Database backups contain sensitive descriptions and analysis input snapshots.
Historical run snapshots can retain deleted transaction evidence until run
retention or user clearing removes them. Feedback for other transactions can keep
a shared run snapshot beyond the ordinary 128-run limit. SQLite WAL files and backups can retain
deleted data; this feature does not promise secure erasure from those locations.

Evidence capture starts on the next ordinary sync. Known settled transaction
keys can receive metadata without overwriting owner edits. The existing 90-day
fetch window limits historical backfill. Previously discarded source text cannot
be recovered from older display labels alone.

## BNPL first release

BNPL means purchase-linked deferred or installment financing. Provider identity,
financing evidence, and transaction role remain distinct.

- A recognized provider plus an explicit product descriptor produces **Likely
  BNPL**. An explicit source `LOAN_PAYMENTS_BNPL` category can also supply evidence.
- Three or four equal withdrawals approximately two weeks apart from a recognized
  financing provider produce **Possible BNPL**, not a verified plan.
- Generic PayPal and Shop Pay recurrence does not establish financing. Provider
  names alone, immediate-payment descriptors, conflicting identities, pending
  authorizations, and void rows do not produce BNPL flags.
- Refunds remain distinct from repayments. A positive amount alone does not
  establish a refund. Missing flags do not establish the absence of BNPL debt.

The catalog and pattern rules are deterministic local heuristics. Their strengths
are qualitative, not calibrated probabilities. No accuracy guarantee exists.
The first version does not reconstruct plans, allocate bundled repayments, infer
remaining balances, or require equal payments for every BNPL product.

Findings only annotate transactions. They never create recurrence rules, enable
imported transactions, create debt accounts, change account values, or change
projection identities. A future model-editing action requires explicit review
and save.

## API and interface

- `GET /v1/analyses` reads execution status without starting work.
- `GET /v1/analysis-findings` reads paginated findings. `postingIds` accepts up to
  200 comma-separated IDs for batch lookup. `limit` is at most 100. `cursor`
  selects the next page. Responses remain private and uncached.
- `PATCH /v1/analysis-findings/{id}` saves `{dismissed: boolean}`. It requires
  write permission and a writable server. Cross-user IDs return 404. Dismissal
  changes evidence presentation only, not the financial-model revision. Its
  `hide`/`restore` events remain separate from explicit positive/negative labels.
- `POST /v1/analysis-findings/{id}/feedback` accepts `requestId`, `runId`,
  `revision`, and `action`. `confirm` records Yes. `reject` records No and
  dismisses the flag. `set-duration` requires a confirmed answer and a
  `duration` of `{count, unit}` with an integer count of 1–5200 and weeks or months.
  Duration means the total plan term, not remaining payments or a repayment schedule.
  Writes require permission and a writable server. An exact request-ID replay
  returns the original event. Reuse with different data, or a changed run/review,
  returns 409. Yes/No also reject changed source inputs. Invalid answers return 422.
  Request IDs use canonical lowercase UUID spelling.
- `GET /v1/analysis-feedback` returns private, uncached, paginated events. It
  accepts `findingId`, `cursor`, and `limit` (at most 100). No raw bank snapshots
  or feedback leave the application for external training.

Configuration's **Analysis** tab lists findings and explanations. Transaction
lists batch-load flags. Transaction details ask only whether the payment is BNPL
from the provider, with Yes/No buttons. Yes asks “How long is the plan?” and saves
weeks or months. Saved answers show a compact provider/duration summary with a
Change action. No removes the prompt. Configuration can restore a rejected finding
for another answer. Restore clears a rejection, but preserves positive confirmation.
Unreviewed stale, dismissed, and withdrawn findings do not flag rows. Confirmed
findings show **BNPL** and survive stale/withdrawn inference. Rejected findings stay
suppressed across detector reruns. Pending, void, and recurring rows keep their
existing exclusions. Browser refreshes read results only; they never run analysis.

## Deployment and verification

Back up the application database. Stop the API. Run the existing explicit
`setupdb` command before starting the new server. Setup installs
`transaction-analysis-v1` and `analysis-feedback-v1`; runtime rejects an incomplete schema. Restore a
compatible backup for schema rollback.

Container releases run that setup through the shared `deploy/migrate.sh` hook.
The hook verifies and preserves a private backup, rejects partial schemas, and
compares existing application rows before API startup. See
[the migration contract](../deploy/MIGRATIONS.md). The backend's HTTP Analysis
routes live in `backend/internal/api/analyses`, under the shared Huma write policy.

Tests cover source retention, known-key backfill, independent execution,
restart recovery, leases, stale publication, withdrawal, dismissal, isolation,
import/clear behavior, explicit setup, passive reads, and unchanged deterministic
and seeded stochastic artifacts. Feedback tests cover immutable history, retries,
revision conflicts, user isolation, schema upgrades, restart, and retained evidence.
Browser tests cover Yes/No, duration edits, lost-response retries, read-only access,
keyboard focus, and accessibility. They use synthetic bank records
through the production mapper, persistence, worker, API, and generated client.
Run the completion gates in `TESTING.md`.
