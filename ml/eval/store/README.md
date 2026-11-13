# ML dataset store (manifest only)

No raw rows are vendored here. This directory holds a registry, not data:
`manifest.json` records sources, row counts, sampling recipes, mapping
pointers, seed hashes, and regeneration commands. Fixtures stay gitignored.

The mitul gated subset stays out of git until its license is confirmed.
Only the deterministic 48,003-row per-key sample trains the seed, and only
from a local gated parquet that is never committed.

Regenerate the 48k sample from a local gated parquet:

```bash
cd ml && uv run --with pyarrow --with pandas -- python3 -c "from pathlib import Path; from eval.datasets import load_mitul; print(len(load_mitul(Path('<path/to/transaction-categorization/default/train/0000.parquet>'))))"
```

Expect 48,003 rows: UNIQUE descriptions per mapped key, 4,000 per key
(TRANSFER_OUT has 3), seed 7, keys sorted. Full seed recipe:

```bash
cd ml && uv run --with pyarrow --with pandas --with openpyxl \
  eval/harness.py --source all \
  --moneydata-path <path/to/laramee26openBankTransactionData.xlsx> \
  --mitul-path <path/to/transaction-categorization/default/train/0000.parquet> \
  --full --cache-dir /tmp/opencode/evalboth \
  --export-seed ml/seed.sqlite3
```

Verify the manifest:

```bash
python3 ml/eval/store/verify.py
```

It checks JSON parses, required keys exist, `ml/seed.sqlite3` sha256
matches the manifest hash, and mapping symbols import from `datasets.py`.
