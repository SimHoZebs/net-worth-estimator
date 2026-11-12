# Evaluation datasets and the seeded learner

The payment-pattern detector and the River learner are proven on public
labeled data before production feedback arrives. This document records
what data, what is real versus synthesized, and how the deployable seed
was produced. No dataset is vendored into the repo; the harness downloads
at eval time into a gitignored cache.

## Sources

| Source | Rows | License / attribution | Use |
| --- | --- | --- | --- |
| `DoDataThings/us-bank-transaction-categories-v2` (Hugging Face) | 68,000 descriptions, 17 categories, 4,000 each | MIT | Descriptor breadth: US statement formats across our exact kinds (Rent, Utilities, Insurance, Income) plus true-negative categories |
| Laramee MoneyData (`laramee26openBankTransactionData.xlsx`, Mendeley `dnxtg6n4rv`, mirror `kaggle.com/datasets/ank1r0/bank-transactions-dataset`) | 6,567 real transactions, one UK account | CC BY 4.0 — cite Firat et al., *MoneyVis: Open Bank Transaction Data and Beyond*, EuroVis Short Papers 2023 | Real timelines and amounts; UK direct-debit recurrence (water, broadband); UK descriptor generalization; year-over-year drift runs |

Ruled out, on record: IEEE-CIS (masked columns, fraud-only — no purpose
signal); `mitulshah/transaction-categorization` (gated, login wall);
`ziadatalabs/FreeFinancialTransactions50M` (no description column —
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

## The seed (`ml/seed.sqlite3`)

552KB SQLite containing only the `model` row: warm weights and per-kind
example counts from training on the full HF v2 set plus all of MoneyData
(27,633 stream-level events: 4,156 payment-pattern plus 23,477
single-transaction category), interleaved per source with payment orders
first then category orders, in manual drift mode with dismiss-and-retry
(10 trips, all dismissed with weights kept and the detector restarted;
one twice-tripping transport batch was halved and retrained in halves,
no event skipped). Coverage gate enforced at export: every payment
classifier kind and every mapped category kind ≥ 50 examples (payment
actual: income 2,924, rent 208, utility 551, auto-insurance 473;
category actual: INCOME 1,031, TRANSFER_IN 1,303, TRANSFER_OUT 2,275,
LOAN_PAYMENTS 559, BANK_FEES 763, ENTERTAINMENT 682, FOOD_AND_DRINK
1,026, GENERAL_MERCHANDISE 3,130, MEDICAL 1,527, PERSONAL_CARE 1,466,
GENERAL_SERVICES 1,133, TRANSPORTATION 1,362, TRAVEL 1,067,
RENT_AND_UTILITIES 5,641). HOME_IMPROVEMENT and
GOVERNMENT_AND_NON_PROFIT are exempt from the 50-example export gate
(no dataset label maps to them; cross-talk training still gave them 43
and 469 examples respectively, so their weights are warm but thinly
evidenced). Probe of 400 requests (200 payment + 200
category) evaluates identically in-memory vs fresh load (400/400).

Regenerate (deterministic):

```bash
cd ml && uv run --with pyarrow --with pandas --with openpyxl \
  eval/harness.py --source all \
  --moneydata-path <path/to/laramee26openBankTransactionData.xlsx> \
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
skips seeding. The Northflank service env carries `ML_SEED_PATH`; the
default Go-only image has no learner and is unaffected.
