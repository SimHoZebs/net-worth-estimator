# Training harness

The detector and the learner are proven on public labeled data before
production feedback arrives. The harness converts backend behavior into
ordered training and measurement events: descriptors go in, findings come
out, findings become a fixed curriculum, and the curriculum trains and
scores throwaway learner instances. Nothing is vendored; the cache is
gitignored; production wiring is untouched.

## Components

| Component | Owns | Lives |
| --- | --- | --- |
| Go backend detection | Kinds, grouping, recurrence, signals, classifications; emits judgment inputs | `backend/` |
| Python River service (`ml/`) | Assessments behind the opaque revision protocol (`PaymentModelStore.state`/`evaluate`/`observe` only) | `ml/model.py`, `ml/server.py` |
| Training harness | Turns backend behavior into ordered training and measurement events; scores lift, drift response, and per-event latency | `backend/cmd/testing/evalharness/main.go` plus `ml/eval/` |

## Halves

The Go half is the deterministic fixture-to-findings driver at
`backend/cmd/testing/evalharness/main.go`. It expands each labeled
descriptor into a synthetic occurrence series, runs the existing
`PaymentPatterns{}.Analyze` nil-resolver plus `.WithProviders` with a
`MapProviderResolver`, and emits findings JSON. It stays in the backend
module; the Python half invokes it with `go run` and never reimplements it.

The Python half is `ml/eval/`. `harness.py` is the thin CLI orchestrator
(argument parsing, per-source run flow, report assembly) importing four
focused siblings:

| Module | Holds |
| --- | --- |
| `datasets.py` | Dataset constants, downloaders, loaders, sampling, alias derivation, and the locked label-to-category mapping tables |
| `events.py` | Go invocation, plus findings/request shaping helpers |
| `scoring.py` | Deterministic scoring, category scoring, alias hit rate, signal support, accuracy helpers |
| `training.py` | `LearnerRun`, ordering, run arms, shift probe, seed recipe |

`seed_export.py` sits alongside: standalone seed export and verification
(`export`/`verify` subcommands), reused by the seed recipe.

## Event stream contract

Fixture JSON in (written by `run_source`, read by the Go driver):

- `meta`: `source`, `rows`, `seed`, `months`, `baseDate`.
- `aliases`: `[{match, signal}]`, derived from the sampled merchants.
- `rows`: `[{description, category, currency?}]`; `currency` rides along
  only on mitul rows and defaults to USD.

Findings JSON out (written by the Go driver, read by `run_go_harness`):

- `meta`: `tool`, `months`, `seed`, `baseDate`, `rows`, `transactions`,
  `aliasCount`.
- `aliases`: echo of the fixture alias table.
- `transactions`: one per descriptor —
  `id`, `description`, `category`, `expectedKind`, `expectedCategory`,
  `direction`, `amount`, `dates`.
- `findings.baseline` / `findings.providers`: per-occurrence findings.
- `findings.categoryRequests`: one entry per representative occurrence —
  `request` (the categorization judgment input), `expectedCategory`,
  `transactionId`.

The Python scorer re-derives every `expectedCategory` from the locked
tables and raises on any mismatch with the Go output, so mapping drift
between the halves fails loudly instead of silently.

## Modes

Measure (default) scores the cold-start baseline without training a kept
model:

```bash
cd ml && uv run --with pyarrow --with pandas eval/harness.py --slice 5000
uv run --with pyarrow --with pandas eval/harness.py --full   # all 68k rows
```

Per-source reports land under `ml/eval/.cache/report{suffix}.json` with a
stdout summary: `deterministic` and `category_deterministic` (pair-counted
precision/recall/F1 plus strict exact-set accuracy), `signal_support`
(backed vs hint-only requests), `strength` (strong vs moderate findings),
`learner` and `category_learner` (pre/post accuracy, lift, ADWIN
trips/warnings, per-event train/eval latency, peak RSS), and
`shift_probe` (synthetic flipped-label drift response).

Train and seed exports a deployable learner database:

```bash
uv run --with pyarrow --with pandas --with openpyxl eval/harness.py \
  --source all --moneydata-path <path/to/xlsx> --mitul-path <path/to/parquet> \
  --slice 5000 --export-seed /tmp/opencode/seed.sqlite3
```

The canonical recipe trains every source's interleaved payment baseline
order in sequence (mitul payments excluded: single occurrences carry no
recurrence signal), then every source's interleaved category order
(HF, then MoneyData, then mitul), in manual drift mode with
dismiss-and-retry so one shift never wipes the seed. Export fails loudly
unless every payment classifier kind and every mapped category kind clears
its coverage minimum; a probe set verifies that a fresh load of the seed
evaluates identically to the in-memory trained state. The canonical seed
is versioned at `ml/seed.sqlite3` (see `docs/eval-datasets.md` for
provenance); regenerate it with the documented command rather than
hand-editing it. Real-vs-synthesized accounting lives in
`ml/eval/README.md`.

## Ownership boundaries

- The backend owns detection behavior and the Go driver's location.
- The River service owns assessment policy and the revision protocol; the
  harness touches only `state`/`evaluate`/`observe` and trains throwaway
  stores (`ML_MODEL_PATH` under `/tmp`, fixed seeds, no wall-clock
  dependence).
- The harness owns ordering and measurement only: it reads findings and
  writes reports and seed databases, and never modifies `model.py` or
  `server.py`.

## Non-goals

- No provider-protocol change: alias and resolver seams are exercised, not
  redesigned.
- No model-policy change: cold-start rules and learner updates are
  measured, not retuned.
- No production-wiring change: seed installation stays operator-owned
  (see `docs/eval-datasets.md`).
- The Go driver stays in the backend module; no second copy under `ml/`.
