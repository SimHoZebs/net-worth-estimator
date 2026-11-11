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
the lifecycle. BNPL, recurring, transfer, and payment-pattern detection are
built-in consumers.
The current worker rechecks the changed user's saved evidence. Payment streams
recompute incrementally: only streams touched by changed bank facts re-derive
statistics and judgments, and findings publish per stream. Unchanged input
revisions skip the user without loading prior findings. It does not require a broker or external API.

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
retaining the monotonic input revision. Model replacement preserves evidence for
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

Findings only annotate transactions. They never create schedules, enable
imported transactions, create debt accounts, change account values, or change
projection identities. A future model-editing action requires explicit review
and save.

## Recurring first release

Recurring means repeated payments and deposits with an approximately regular
cadence. Merchant identity, cadence evidence, and forecast schedules remain distinct.

- Weekly, biweekly, monthly, quarterly, and annual patterns are detected from
  settled bank evidence grouped by source, account, currency, direction, and a
  descriptive stream shared with purpose assessments. Three occurrences establish weekly through quarterly
  patterns; two establish an annual pattern.
- Each occurrence carries its own finding. Its evidence lists every occurrence
  in the pattern plus the estimated cadence and typical source amount, so the
  user can inspect the full basis without trusting a single row.
- Merchant-name variants share one pattern through merchant-key normalization;
  small amount and timing differences stay inside a stated tolerance while a
  far-off gap or outlier amount breaks the pattern. The cadence thresholds and
  tolerances are heuristics with qualitative strength, not calibrated
  probabilities. No accuracy guarantee exists.
- Confirm and reject corrections apply to recurring findings without rewriting
  immutable source facts. Plan duration stays BNPL-specific and never corrects
  a recurrence claim. Editing cadence or amount estimates beyond confirm and
  reject is an open product decision.
- A fortnightly installment series may hold both a Possible BNPL claim and a
  biweekly recurring claim on the same transactions. Withdrawing, confirming,
  or rejecting one producer's claim never disturbs the independent claim.

Like BNPL, recurring findings never create schedules or change the
financial model. Creating a forecast schedule from a confirmed pattern is a
separate explicit action with its own review.

## Income first release

Income means an external inflow that plausibly funds the model. Repetition is
an independent assessment, not a prerequisite for explicit income evidence.
Deposit, cadence, estimate, and provenance stay distinct per `TERMS.md` `F`.
The Go observation extractor is deterministic and owns evidence. A provider-neutral
judgment boundary can refine strength using a model, rules, or an asynchronous
human queue. The feature never selects an algorithm or interprets a probability.

- Inflows are assessed from settled bank evidence grouped by source, account, currency,
  normalized description, payee, merchant metadata, and income evidence.
  The short merchant label is for display, not the payment-stream identity.
  Payroll descriptors and source income categories separate distinct streams
  before amount filtering, so small payments from an employer cannot suppress
  its payroll. Variable bank reference suffixes and opaque reference tokens
  are excluded from grouping but retained in immutable source evidence.
  When repetition is established, three occurrences establish weekly through
  quarterly patterns; two establish an annual pattern. Annualized estimate
  is the median source amount times periods per year (52, 26, 12, 4, 1).
- A payroll descriptor (payroll, salary, paycheck, direct deposit, direct
  deposit abbreviation, ACH credit) or a source category that maps to
  `INCOME` supports income even for one observation. Regular cadence alone is
  an uncertain candidate. Without repetition, cadence and annual estimate remain
  unestablished rather than extrapolated from one payment.
- Internal transfers are excluded by the exact opposite-leg rule from the
  transfer detector (same absolute amount, opposite direction, different
  account, within seven days). Refunds, reversals, chargebacks, and returns
  are excluded by marker. Pending, void, zero, invalid, and undated rows
  never form patterns.
- Each occurrence carries its own finding. Its evidence lists every
  occurrence in the pattern plus the estimated cadence, typical source
  amount, and annualized estimate, so the basis is inspectable from one row.
  The Payment patterns list groups occurrences into one card per classification and pattern, with
  source-currency amounts supplied as structured fields rather than parsed
  from explanations or reconstructed from training features. Cards match the
  repeating-payments layout: title, status badge, typical amount plus cadence
  plus recorded count, Confirm plus Not answers, and the same forecast
  actions (create a new schedule or link to an existing schedule, each behind
  its preview, recording confirmation). Repetition always stays
  a standalone card list. Repetition answers never imply income
  or rent, and purpose answers never confirm repetition.
  Review uses the latest answered eligible occurrence, or the first eligible
  occurrence for an unanswered pattern. It saves one explicit label and never
  rewrites the other recorded answers. Withdrawn findings remain separate
  from current patterns.
- The highest candidate with established repetition is marked `income.main-inflow:annualized`
  and described as the main consistent inflow. Other candidates keep
  `income.inflow:annualized`. Ranking is by annualized estimate desc with
  merchant and cadence tie breaks, so the user does not have to state the
  main inflow. Ranking is withheld when candidates have different or missing
  currencies because source amounts cannot be compared without conversion.
  Confirm records only the answer and never creates a schedule; the card's
  forecast actions create or link schedules and record confirmation.
- Cross-claim independence holds: a deposit may carry recurring, income,
  and transfer claims without competing. Withdrawing, confirming, or
  rejecting one kind never disturbs the others.

## Replaceable judgment providers

Income and rent now share the [payment-stream classification pipeline](payment-patterns.md).

`judgment.Provider.Open` owns implementation-specific preparation and returns
a session with an opaque revision and an evaluator. `PaymentPatterns` sees only domain
evidence and `ready`, `pending`, or `unavailable` judgments. Learning is optional:
response-only and human-queue adapters do not implement a training API.

- Saved `judgmentInput` contains source-currency pattern statistics and at most
  three recent source observations. Feature scaling and categorical encoding
  belong inside a provider, never the detector, API, store, or UI.
- Pattern identity includes owner, source, account, currency, merchant, and
  cadence. Request identity hashes the exact domain evidence separately, so a
  late answer for different evidence cannot be attached to a current request.
- A ready judgment provides an explicit decision (`supported`, `unsupported`,
  or `uncertain`), domain strength (`strong` or `moderate`) and an
  optional explanation. The common boundary rejects malformed, duplicate,
  missing, or mismatched responses before applying any judgment in a batch.
- A pending judgment publishes deterministic findings with `judgment-pending`.
  Unavailability publishes deterministic findings with `judgment-unavailable`.
  Both are retryable after 30 seconds; neither blocks the worker or invents a
  user's answer. A provider revision change refreshes unchanged bank evidence.
- Explicit confirm/reject feedback remains an immutable, owner-scoped audit
  event with the original request and run. Providers may consume it or ignore
  it. Hide and restore are never labels. API reviews never wait on a provider.
- User bank evidence and review decisions stay owner-scoped regardless of the
  provider. Provider judgments never mutate the financial model or another
  person's explicit answer.

The default composition uses the neutral HTTP protocol when
`ML_JUDGMENT_URL` is set. With no URL, detection is deterministic. Deploying
a different compatible service at that URL changes no detector, persistence,
or UI code. In-process adapters implement the same Provider port. See
[the provider contract](judgment-providers.md) for replacement and privacy rules.

The supplied implementation is the River service in `ml`. It alone
owns scaling, probability thresholds, example counts, drift detection, and one
shared online-learning model per deployment. Those details are absent from the
application contract. See `ml/README.md` for its private storage and
deployment requirements.

## Pattern to new schedule

A repeating or payment pattern becomes planned cash flow through an explicit schedule
action: preview, then create or link. Saving also records acceptance of the
pattern in the same database transaction. No standalone confirmation is required.
Previewing or cancelling never records acceptance. Observed patterns
and forecast definitions stay different resources: findings and feedback
remain the evidence, schedules remain the forecast.

- `GET /v1/analysis-findings/{id}/pattern-to-new-schedule-preview` describes the schedule the
  pattern would create (name, amount, schedule, start) plus the forecast
  movements behind it and the recorded evidence. The plan stays visible
  before acceptance, with creation available directly. Patterns that repeat
  every two weeks stay visible with a plain-language reason: schedules expand
  weekly, monthly, quarterly, or yearly, and no biweekly schedule exists
  yet.
- `POST /v1/analysis-findings/{id}/pattern-to-new-schedule` creates the approved
  schedule through the ordinary finance row-write contract (validation,
  revision, last-write-wins). It accepts an active, non-dismissed finding and refuses a
  second active schedule for the same pattern with 409.
- One active generated schedule belongs to one confirmed source pattern. The
  record lives in `analysis_promotions` beside the evidence, never inside the
  financial rows. Disabling or deleting the schedule leaves findings and
  feedback intact; a disabled or deleted schedule frees the pattern for a
  replacement.
- The generated schedule always starts one full interval after the latest
  recorded movement, so approval never duplicates bank facts as forecast
  movements. Creation reads evidence only; preview is available in
  read-only mode while approval requires write permission.
- Confirm and reject corrections apply to every independent claim kind.
  Plan duration stays BNPL-specific and never corrects a recurrence claim.

Setup installs `analysis_promotions` alongside the other Analysis tables;
runtime rejects an incomplete schema. The deployment body provisions the
record table for sources that predate it and verifies it on candidates. A
user clear removes pattern-to-new-schedule records with the model rows they name.

## Pattern to existing schedule

A repeating or payment pattern can also claim an existing schedule's occurrences instead
of creating a new schedule. Each recorded movement becomes a manual
`TransactionClaim` against its nearest free scheduled occurrence, so the
projection stops double-counting and the recorded rows stay intact.

- `GET /v1/analysis-findings/{id}/pattern-to-existing-schedule-preview?scheduleId=...`
  maps every occurrence to its nearest unused scheduled date (oldest
  first, skipped months stay skipped) with a plain-language reason when
  the schedule is disabled, routing differs, or no date falls within
  tolerance (15% of the nominal interval, at least one day). Preview is
  available in read-only mode, like new-schedule preview.
- `POST /v1/analysis-findings/{id}/pattern-to-existing-schedule` with `{scheduleId}`
  accepts an active, non-dismissed finding and applies all claims and pattern
  acceptance through the ordinary finance validation boundary in one atomic store write
  (concurrent additions serialize on a process-wide mutex). Already-correct
  claims stay put; other enabled transactions' claims on the same dates are
  never reused (disabled rows claim nothing, so their dates stay free).
  Success returns the claimed rows, finance warnings, and the
  model revision. Retries are idempotent.
- Adding never creates schedules or rewrites amounts, names, or dates. It
  only sets `claim.scheduleId` plus `claim.occurrenceDate`, exactly as the
  manual occurrence link in TransactionDetail does, but for the whole
  pattern at once with schedule guidance. Clearing a claim stays a manual
  single-row edit.

## Transfer matching

Transfer means one internal money movement observed as two opposite legs on
different accounts. The detector pairs legs by exact absolute amount, opposite
direction, and transaction dates within 7 days. A leg with exactly one
mutual candidate produces a **strong** match; a leg with several candidates
produces a **moderate** match that lists every candidate for review.

- The 7-day window is decided: both sides of a transfer between owned
  accounts are logged as one movement, but the two records do not arrive in
  sync, so legs can be days apart.
- Amounts match exact to the cent by decision. Near-matches from fees or
  currency conversion stay unmatched; they are never surfaced as candidates.
- An unmatched leg emits no finding. Missing legs are never fabricated.
- Same-account opposite legs are corrections or refunds, not transfers.
- Pending, void, non-USD, zero, invalid, and undated rows never match.
- Each leg carries its own finding, so transfer evidence coexists with BNPL
  and other independent claims on one transaction. Dismissal survives
  detector reruns; repeated imports refresh the same findings.
- Open: whether review stays a candidate list in the findings or becomes a
  dedicated pair-picker, and whether same-provider legs should score
  stronger than cross-provider pairs. Both keep current behavior for now:
  candidates list in findings with equal scoring.

## API and interface

- `GET /v1/analyses` reads execution status without starting work.
- `GET /v1/analysis-findings` reads paginated findings. `transactionIds` accepts up to
  200 comma-separated IDs for batch lookup. `limit` is at most 100. `cursor`
  selects the next page. Responses remain private and uncached.
- `PATCH /v1/analysis-findings/{id}` saves `{dismissed: boolean}`. It requires
  write permission and a writable server. Cross-user IDs return 404. Dismissal
  changes evidence presentation only, not the financial-model revision. Its
  `hide`/`restore` events remain separate from explicit positive/negative labels.
- `POST /v1/analysis-findings/{id}/feedback` accepts `requestId`, `runId`,
  `revision`, and `action`. `confirm` records Yes. `reject` records No and
  dismisses the flag. Confirm and reject apply to every independent claim
  kind; `set-duration` requires a confirmed BNPL answer and a
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
and seeded stochastic runs. Feedback tests cover immutable history, retries,
revision conflicts, user isolation, schema upgrades, restart, and retained evidence.
Browser tests cover Yes/No, duration edits, lost-response retries, read-only access,
keyboard focus, and accessibility. They use synthetic bank records
through the production mapper, persistence, worker, API, and generated client.
Run the completion gates in `TESTING.md`.
