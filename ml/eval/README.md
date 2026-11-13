# Real-dataset evaluation harness

Proves the payment-pattern pipeline on public data: descriptor rows from a
real labeled dataset are normalized through the existing Go backend
(grouping, recurrence, signals, classifications), scored against dataset
labels, used to train the River learner, and subjected to drift-diagnosis
arms. Timing measurements substantiate the online-learner volume claim.

## Dataset

- Source: `DoDataThings/us-bank-transaction-categories-v2` (Hugging Face).
- License: **MIT** (from the dataset card metadata).
- Content: 68,000 rows, exactly two columns: `description`
  (US bank-statement-format strings such as `[debit] PG&E`,
  `TRAVELERS PREMIUM PPD`, `BROOKFIELD RENT PMT`, `FARMERS INS BILLING`)
  and `category` (17 values: Restaurants, Groceries, Shopping,
  Transportation, Entertainment, Utilities, Subscription, Healthcare,
  Insurance, Mortgage, Rent, Travel, Education, Personal Care, Transfer,
  Income, Fees; 4,000 rows each).
- Honesty note: the card calls it a synthetic dataset. The descriptors are
  synthesized but modeled on real bank formats with 500+ real merchant
  names; the labels are provided. Treat results as evidence about
  descriptor handling, not as production precision/recall.

Second category arm:

- Source: `mitulshah/transaction-categorization` (Hugging Face, gated —
  evaluated from a local copy, never vendored).
- Content: 4,501,043 rows, four columns
  (`transaction_description`/`category`/`country`/`currency`), 10 balanced
  categories (~450k each) of clean merchant-name descriptions (no
  bank-statement noise, no direction markers, no amounts). It trains
  descriptor breadth only — it never replaces owner labels as ground truth.
- Sampling: UNIQUE descriptions per mapped key, 4,000 per key (fewer only
  when a key exhausts uniques: TRANSFER_OUT has 3), fixed seed 7,
  stratified — 48,003 rows regardless of `--slice`/`--full`. Currency is
  carried as-is; amounts are synthesized per-label plausible bases with the
  same ±5% jitter as the HF arm; `months` is 1 (single representative
  occurrence, no payment-series synthesis).

## Category mapping (locked)

HF/MoneyData labels map onto category keys identically in the Go
evalharness and the Python scorer (a mismatch raises): Income→INCOME,
Rent→RENT_AND_UTILITIES, Utilities→RENT_AND_UTILITIES,
Insurance→GENERAL_SERVICES, Mortgage→LOAN_PAYMENTS,
Transfer→TRANSFER_IN on inflow else TRANSFER_OUT, Groceries→FOOD_AND_DRINK,
Restaurants→FOOD_AND_DRINK, Shopping→GENERAL_MERCHANDISE,
Transportation→TRANSPORTATION, Entertainment→ENTERTAINMENT,
Subscription→ENTERTAINMENT, Healthcare→MEDICAL, Travel→TRAVEL,
Education→GENERAL_SERVICES, Personal Care→PERSONAL_CARE, Fees→BANK_FEES.
HOME_IMPROVEMENT and GOVERNMENT_AND_NON_PROFIT stay exempt by policy — no
HF/MoneyData label maps to them, so they stay cold-start baseline until
production feedback arrives (the mitul arm warms their weights in the
meantime).

Mitul labels map identically in Go (`splitMitul`) and Python
(`resolve_expected_mitul`); a mismatch raises: Food & Dining→FOOD_AND_DRINK,
Transportation→TRANSPORTATION, Shopping & Retail→GENERAL_MERCHANDISE except
IKEA/HOME DEPOT/LOWES descriptions→HOME_IMPROVEMENT, Entertainment &
Recreation→ENTERTAINMENT except gym/fitness descriptions→PERSONAL_CARE,
Healthcare & Medical→MEDICAL, Utilities & Services→RENT_AND_UTILITIES,
Financial Services→LOAN_PAYMENTS on loan/mortgage words, GENERAL_SERVICES
on insurance/tax words, TRANSFER_OUT on withdrawal, else DROP (bare
bank/investment names carry no mappable key and never reach the fixture),
Income→INCOME, Government & Legal and Charity & Donations both
→GOVERNMENT_AND_NON_PROFIT. Direction is label-derived (Income inflow, all
others outflow); currency rides along as-is.

The data is **never vendored**: the harness downloads the 1.6MB parquet at
eval time into `ml/eval/.cache/` (gitignored) and reuses it on later runs.

## What is real vs synthesized

| Element | Provenance |
| --- | --- |
| Descriptor strings, dataset labels | Real (dataset) |
| `[debit]`/`[credit]` marker | Dataset artifact; stripped by the Go harness, direction only |
| Occurrence dates (monthly series) | Synthesized: fixed base date `2023-01-15`, exact 30-day spacing, deterministic ±1-day wobble, fixed seed 7 |
| Amounts | Synthesized: plausible per-category bases (documented in `backend/cmd/testing/evalharness/main.go`), deterministic ±5% jitter inside detector tolerance |
| Provider alias table | Derived from the dataset's own merchant strings (first-token heuristic mirroring `recurringKey`); hit rate is reported so mismatch is visible |
| Bank-category metadata | Dataset label reused as the bank-category stand-in (drives source-income/source-rent hints; see the `signal_support` split) |
| Shift-probe contradict labels | Synthetic by construction (flipped), never dataset evidence |

Reproducible: fixed seeds, no wall-clock dependence. Default run samples
≈5,000 rows (4,998 after stratified per-category rounding, seed 7);
`--full` processes all 68,000.

## How to run

From the repo root toolchain (Go; Python via `uv`, pinned
`river==0.22.0`; `pyarrow`/`pandas` are `--with` extras, never project
dependencies):

```bash
cd ml && uv run --with pyarrow --with pandas eval/harness.py --slice 5000
uv run --with pyarrow --with pandas eval/harness.py --full   # all 68k rows
uv run --with pyarrow --with pandas --with openpyxl eval/harness.py \
  --source all --moneydata-path <path/to/laramee26openBankTransactionData.xlsx> \
  --mitul-path <path/to/transaction-categorization/default/train/0000.parquet> \
  --slice 5000 --export-seed /tmp/opencode/seed.sqlite3
```

`--source` selects `hf-v2` (default), `moneydata` (needs `--moneydata-path`),
`mitul` (needs `--mitul-path`, defaults to the path above), or `all`
(per-source reports plus a combined seed phase).

Seed export (canonical recipe: per-source interleaved payment baseline
orders — mitul excluded, its single occurrences carry no recurrence signal —
followed by per-source interleaved category orders: HF, then MoneyData, then
mitul; manual drift mode with dismiss-and-retry, fixed seeds) trains a kept store, then
writes a seed database containing ONLY the model row (warm weights,
counts, generation, revision) with events/checkpoints emptied and drift
counters reset. Export fails loudly unless every payment classifier kind
and every mapped category kind clears its coverage minimum (50 examples;
HOME_IMPROVEMENT and GOVERNMENT_AND_NON_PROFIT stay exempt by policy — the
mitul arm warms them, but they remain baseline until production feedback).
The harness also writes a probe set (`--seed-probe`)
covering payment, HF/MoneyData category, and mitul category requests (200
each) and verifies that a fresh load of
the seed evaluates the probe identically to the in-memory trained state. The canonical seed is versioned at `ml/seed.sqlite3` (see
`docs/eval-datasets.md` for provenance); regenerate with the command
above rather than hand-editing it. Standalone use:
`python eval/seed_export.py export --src ... --dest ...` and
`python eval/seed_export.py verify --seed ... --probe ...`.
Reproducibility covers weights, counts, revision, and decisions; the
`generation` UUID is preserved verbatim and differs per export.

Stages: (1) download parquet, (2) sample + build fixture (rows + alias
table), (3) Go harness expands each descriptor into a monthly occurrence
series and runs `PaymentPatterns{}.Analyze` nil-resolver plus
`.WithProviders` with a `MapProviderResolver`, and emits one
`categorization.CategoryJudgmentRequests` set per descriptor for the
category arm, (4) Python scores deterministic output vs labels, trains
throwaway `PaymentModelStore` instances (`ML_MODEL_PATH` under `/tmp`,
`ML_DRIFT_MODE=auto`),
(5) optionally exports a verified seed DB (`--export-seed`), and
(6) writes `ml/eval/.cache/report.json` plus a stdout summary. The harness
touches only `PaymentModelStore.state/evaluate/observe` (stable API).

## How to read the report

- `deterministic.<arm>.per_kind`: precision/recall/F1 per kind against
  dataset labels (pair-counted: one confusion pair per predicted kind, so
  an extra uncertain finding on an already-correct transaction costs
  precision); `accuracy` is the stricter exact-predicted-set match;
  `confusion` shows rent-vs-utility-vs-insurance cross-talk;
  `none_clean_rate` is the true-negative rate on labels with no classifier
  (Mortgage, Groceries, ...).
- `alias_hit_rate`: fraction of alias-covered (utility/insurance) provider-arm
  findings that gained a provider signal. Low values mean the alias keys
  missed and the descriptor-vs-provider comparison is void.
- `signal_support`: requests carrying descriptor/provider backing vs
  hint-only requests (every observed signal is `regular-cadence`,
  `source-income`, or `source-rent`). Hint-only requests move between
  supported and uncertain on policy changes with no descriptor evidence
  changing; a recall gap concentrated there is a hint-coverage story, not
  a model story.
- `strength` (per expected kind): finding counts split into detector-
  `strong` (supported on its own evidence) vs `moderate` (uncertain
  candidate). A support→candidate policy demotion shows up as a
  strong→moderate migration with recall unchanged.
- `learner.<arm>`: strict accuracy before/after training on the same
  requests (`uncertain` counts as wrong), lift, ADWIN trips/warnings, and
  per-event train/eval latency (median/p90) with peak RSS. `pre` is the
  cold-start baseline (decisive domain rules); small post-training volumes
  typically show a negative strict lift because the undertrained model
  hedges `uncertain` — watch `decisive_rate` recover as event volume grows
  rather than reading early negative lift as model damage.
- `category_deterministic`: cold-start keyword-policy baseline per
  category key (precision/recall/F1, confusion): only support-backed kinds
  predict; uncertain and missing predictions count as wrong wherever an
  expectation exists; `accuracy` is the stricter exact-predicted-set match;
  `none_clean_rate` is the true-negative rate on rows with no mapped
  category (MoneyData unmapped rows).
- `category_learner.<arm>`: strict accuracy before/after training on the
  same category requests (`confirm` the expected kind, `reject` other
  emitted kinds for the same transaction), lift, trips, and per-event
  latency. Small volumes show the same negative strict lift as the payment
  arms while the undertrained model hedges `uncertain`; watch
  `decisive_rate` recover as event volume grows.
- `shift_probe`: synthetic abrupt label flip after convergence; shows the
  detector actually trips and what the accuracy cost looks like.
- `seed`: always `null` in the persisted report; the combined export summary (path, revision, counts, `verification.identical`) is printed to stdout by `--export-seed`.

## Drift-diagnosis guide

Map observed outcomes to verdicts:

- **Accuracy drop on new data + ADWIN trips up**: real shift. The error
  process moved; reset/retrain is justified.
- **Trips up, accuracy flat**: oversensitive detector. The error process
  did not move; consider raising ADWIN `delta` or dismissing, not
  retraining.
- **Low accuracy, no trips**: features/model unsuitable. The learner
  never saw a learnable error signal; fix signals or features (e.g. alias
  coverage, descriptor gaps), not the detector.
- **Provider arm >> descriptor arm on utility/insurance**: alias-catalog
  gap. Extend provider resolution rather than tuning the model.
- **Misses concentrated on short merchants** (e.g. `PG&E` normalizes to
  no grouping token): stream-identity limit in `recurringKey`, an
  unsuitable-workload boundary, not drift.
- **Recall misses with no request at all**: streams the detector never
  emitted never reach the learner; training only corrects emitted
  decisions, it cannot invent coverage.
