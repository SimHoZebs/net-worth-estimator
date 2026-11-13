# Evaluation datasets and the seeded learner

The payment-pattern detector and the River learner are proven on public
labeled data before production feedback arrives. This document records
what data, what is real versus synthesized, and how the deployable seed
was produced. No dataset is vendored into the repo; the harness downloads
at eval time into a gitignored cache.

Machine-readable registry: `ml/eval/store/manifest.json` records each
source with row counts, sampling recipes, mapping pointers, seed hashes,
and regeneration commands; `ml/eval/store/README.md` covers verification.
No raw rows live there.

## Sources

| Source | Rows | License / attribution | Use |
| --- | --- | --- | --- |
| `DoDataThings/us-bank-transaction-categories-v2` (Hugging Face) | 68,000 descriptions, 17 categories, 4,000 each | MIT | Descriptor breadth: US statement formats across our exact kinds (Rent, Utilities, Insurance, Income) plus true-negative categories |
| Laramee MoneyData (`laramee26openBankTransactionData.xlsx`, Mendeley `dnxtg6n4rv`, mirror `kaggle.com/datasets/ank1r0/bank-transactions-dataset`) | 6,567 real transactions, one UK account | CC BY 4.0 — cite Firat et al., *MoneyVis: Open Bank Transaction Data and Beyond*, EuroVis Short Papers 2023 | Real timelines and amounts; UK direct-debit recurrence (water, broadband); UK descriptor generalization; year-over-year drift runs |
| `mitulshah/transaction-categorization` (Hugging Face, gated — local copy, never vendored) | 4,501,043 rows, 10 balanced categories (~450k each); eval sample 48,003 unique descriptions (4,000 per mapped key, TRANSFER_OUT 3) | Gated, license unconfirmed — eval-use only | Clean merchant-name descriptor breadth (no statement noise, no direction markers); per-key category coverage incl. HOME_IMPROVEMENT and GOVERNMENT_AND_NON_PROFIT |

Ruled out, on record: IEEE-CIS (masked columns, fraud-only — no purpose
signal); `ziadatalabs/FreeFinancialTransactions50M` (no description column —
useless for classification, volume-only); `Or4kool/transactions_data`
(813 rows, South-African rails — too small and off-distribution).

## Real vs synthesized (HF v2 arm)

| Element | Provenance |
| --- | --- |
| Descriptor strings, dataset labels | Real dataset |
| `[debit]`/`[credit]` marker | Dataset artifact; stripped before grouping, direction only |
| Occurrence dates (monthly series) | Synthesized: fixed base date, exact 30-day spacing, deterministic ±1-day wobble, fixed seed |
| Amounts | Synthesized per-category plausible bases with ±5% jitter (inside detector tolerance) |
| Provider alias table | Derived from the dataset's own merchant strings (first-token heuristic mirroring `recurringKey`); hit rate reported so mismatch is visible |

## Real vs synthesized (MoneyData arm)

Descriptions, direction (from the debit/credit columns), and the mapped
expected label are real; occurrence timing and amounts are still
synthesized by the Go harness, so this arm tests UK descriptor and label
generalization today. Wiring real timelines through is tracked future
work. Category mapping (documented judgment calls): water/energy/broadband
bills, council tax, and TV licence → Utilities; LV/Assurant/Zurich/Aviva →
Insurance; Principality/NatWest/Santander → Mortgage (no classifier:
true-negative check); one Peter Alan row → Rent; Swansea University rows →
Income. Expect descriptor misses on UK-specific wording (`VIRGIN MEDIA`
has no generic utility words; `SWANSEA UNI - PAY` has no payroll words) —
those are resolver-alias and descriptor-coverage findings, not model
failures.

## Real vs synthesized (mitul arm)

Descriptions, currency (as-is: USD/GBP/AUD/CAD/INR), and the mapped
expected label are real; direction is label-derived (Income inflow, all
others outflow — descriptions carry no marker), occurrence timing is a
single representative occurrence (`months=1`, no payment-series synthesis),
and amounts are per-label plausible bases with the same ±5% jitter as the
HF arm. Sampling is UNIQUE descriptions per mapped key (4,000 per key;
TRANSFER_OUT has only 3 unique withdrawal strings in the source), fixed
seed 7, keys in sorted order. Locked mapping: Food & Dining→FOOD_AND_DRINK,
Transportation→TRANSPORTATION, Shopping & Retail→GENERAL_MERCHANDISE except
IKEA/HOME DEPOT/LOWES→HOME_IMPROVEMENT, Entertainment &
Recreation→ENTERTAINMENT except gym/fitness→PERSONAL_CARE, Healthcare &
Medical→MEDICAL, Utilities & Services→RENT_AND_UTILITIES, Financial
Services→LOAN_PAYMENTS on loan/mortgage, GENERAL_SERVICES on insurance/tax,
TRANSFER_OUT on withdrawal, else DROP (bare bank/investment names never
reach the fixture), Income→INCOME, Government & Legal and Charity &
Donations→GOVERNMENT_AND_NON_PROFIT. Expect recall misses where a clean
merchant name carries no keyword evidence and emits no request at all
(single generic words, short names) — a descriptor-coverage finding, not a
model failure.

## The seed (`ml/seed.sqlite3`)

1000KB SQLite containing only the `model` row: warm weights and per-kind
example counts from training on the full HF v2 set plus all of MoneyData
plus the 48,003-row mitul sample (55,425 stream-level events: 4,156
payment-pattern plus 51,269 single-transaction category — 24,925 HF, 1,223
MoneyData, 25,121 mitul), interleaved per source with payment orders first
(mitul excluded: single occurrences carry no recurrence signal) then
category orders HF, MoneyData, mitul, in manual drift mode with
dismiss-and-retry (17 detections, all dismissed with weights kept and the
detector restarted; three twice-tripping batches were halved and retrained
in halves, no event skipped). Coverage gate enforced at export: every
payment classifier kind and every mapped category kind ≥ 50 examples
(payment actual: income 2,924, rent 208, utility 551, auto-insurance 473;
category actual: INCOME 1,519, TRANSFER_IN 1,502, TRANSFER_OUT 3,603,
LOAN_PAYMENTS 2,562, BANK_FEES 763, ENTERTAINMENT 1,579, FOOD_AND_DRINK
3,692, GENERAL_MERCHANDISE 4,283, MEDICAL 3,658, PERSONAL_CARE 5,558,
GENERAL_SERVICES 5,649, TRANSPORTATION 2,062, TRAVEL 1,437,
RENT_AND_UTILITIES 6,537). HOME_IMPROVEMENT and
GOVERNMENT_AND_NON_PROFIT stay exempt from the 50-example export gate by
policy (the mitul arm still warmed them with 4,043 and 2,822 examples
respectively, so their weights are warm but thinly evidenced). Probe of
600 requests (200 payment + 200 HF/MoneyData category + 200 mitul
category) evaluates identically in-memory vs fresh load (600/600).

## Prod-label fine-tune and the keyword-first default

A read-only copy of the prod app database (17MB, owner-only handling, never
committed) supplied 282 owner-reviewed labels across 12 keys (12 answers
given directly by the owner, 262 confident assistant proposals the owner
delegated, 8 flagged guesses; 16 rows emit no request and stay
uncategorized). Training on 80% with the warm seed reproduces the known
small-volume hedge (train set itself scores mostly uncertain), so the seed
was deliberately not re-exported from prod labels and no prod data entered
the repo. The enable decision was measured instead, with real components on
all 266 emitting groups: keyword alone 84 correct with zero wrong;
keyword-first with learner backfill 232 correct with 6 new errors on rows
that would otherwise stay uncategorized (joint correct 87.2%). Held-out
public merchants never trained on score 0.91 confident precision with 85%
production-outcome correct, so the model generalizes rather than
memorizing. Keyword-first ordering (learner can add, never replace) plus
the ML_CATEGORIES=0 kill switch is the shipped default on that evidence.

Regenerate (deterministic):

```bash
cd ml && uv run --with pyarrow --with pandas --with openpyxl \
  eval/harness.py --source all \
  --moneydata-path <path/to/laramee26openBankTransactionData.xlsx> \
  --mitul-path <path/to/transaction-categorization/default/train/0000.parquet> \
  --full --cache-dir /tmp/opencode/evalboth \
  --export-seed ml/seed.sqlite3
```

Then copy the export over `ml/seed.sqlite3` deliberately — never as a
drive-by. Removing the seed requires removing the Dockerfile `COPY` and
the `ML_SEED_PATH` env together, or every image build fails.

Generalization check (held-out distribution, not train-set accuracy):
a learner trained on HF-only baseline findings scores 10/11 on
MoneyData agreeing probes (utility 7/7 including UK merchants, income
3/3; the single miss is the lone rent row, which carries no rent
signal in any dialect — a documented descriptor gap, not a model
failure). An ADWIN trip fired mid-training without collapsing the
transfer.

## Boot behavior (`deploy/northflank/runtime.py`)

Seed wiring is live: at boot the runtime installs the baked seed over a
missing or unlearned live database, keeps a database that recorded
feedback or holds a pending drift review, and fails loud on corruption.

The ML service starts before the Go server. When `ML_SEED_PATH` points at
the baked seed, it is installed as `ML_MODEL_PATH` only if the live
database is missing or shows zero learning (empty `events` table, no
pending drift review). A database that recorded feedback is never
overwritten; a corrupt one fails loud for the operator. `ML_SEED_DISABLE=1`
skips seeding. The Northflank image sets `ML_SEED_PATH=/app/ml/seed.sqlite3`;
the default Go-only image has no learner and is unaffected.
