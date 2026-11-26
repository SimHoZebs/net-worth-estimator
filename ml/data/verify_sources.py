#!/usr/bin/env python3
"""Verify ml/data/sources/manifest.json against repo state. Read-only."""

import hashlib
import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent
REPO = DATA_DIR.parent.parent
EVAL = REPO / "ml" / "eval"

REQUIRED = {"id", "source", "rows_total", "rows_used", "license",
            "local_path_hint", "sampling", "mapping", "seed_contribution",
            "regenerate"}


def main() -> int:
    manifest = json.loads((DATA_DIR / "sources" / "manifest.json").read_text())
    ids = [e["id"] for e in manifest["entries"]]
    assert ids == ["hf-v2", "moneydata", "mitul-sample", "seed",
                   "prod-labels-note"], ids
    for entry in manifest["entries"]:
        missing = REQUIRED - set(entry)
        assert not missing, (entry["id"], missing)
    seed = next(e for e in manifest["entries"] if e["id"] == "seed")
    seed_path = REPO / "ml/data/seeds/runtime-v1/seed.sqlite3"
    digest = hashlib.sha256(seed_path.read_bytes()).hexdigest()
    assert digest in seed["content_pointer"], (digest, seed["content_pointer"])
    seed_manifest = json.loads((DATA_DIR / "seeds" / "manifest.json").read_text())
    runtime = next(e for e in seed_manifest["entries"] if e["id"] == "runtime-v1")
    assert runtime["sha256"] == digest, (runtime["sha256"], digest)
    assert runtime["bytes"] == seed_path.stat().st_size
    sys.path.insert(0, str(REPO / "ml"))
    sys.path.insert(0, str(EVAL))
    import datasets  # noqa: E402
    import training  # noqa: E402

    for name in ("EXPECTED_KIND", "EXPECTED_CATEGORY", "MITUL_PER_KEY",
                 "SEED", "MONEYDATASET_ID", "load_mitul", "load_moneydata",
                 "resolve_expected_mitul", "PARQUET_URL"):
        assert hasattr(datasets, name), name
    assert hasattr(training, "run_seed_recipe")
    assert datasets.MITUL_PER_KEY == 4000 and datasets.SEED == 7
    print(f"manifest ok: {len(manifest['entries'])} entries; seed sha {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
