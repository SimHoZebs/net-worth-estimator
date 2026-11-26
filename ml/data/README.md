# ML data root

ML training code lives in `ml/eval/` and `ml/*.py`. ML training data lives here.
Server-owned merchant classification data lives in
`backend/internal/categorization/merchantdata/`.

## Tracked

- `sources/manifest.json`: metadata only, no rows.
- `seeds/runtime-v1/seed.sqlite3`: versioned deployment seed, model row only.
- `seeds/manifest.json`: seed hashes and invariants.
- `derived/public/`: minimized immutable public releases only.

## Ignored

- `cache/raw/`: downloaded HF parquet. MoneyData and gated inputs stay external and are supplied by path.
- `work/`: per-run fixture and findings JSON.
- `reports/runs/`: per-run reports.
- `seeds/probes/`: seed verification probes.

## Never tracked

Mitul rows, production rows, account identifiers, raw request samples, or private databases. The manifest may record counts and hashes for gated or private sources, following the existing prod-labels-note precedent.
