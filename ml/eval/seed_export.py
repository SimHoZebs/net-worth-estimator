#!/usr/bin/env python3
"""Deterministic seed-database export for the River payment learner.

After an eval training run, produces a seed database containing ONLY the
model row (warm weights, classification counts, generation, revision) with
the events and checkpoints tables emptied and the drift counters reset, so a
fresh deployment can boot from learned weights without replaying feedback.
The canonical seed lives versioned at ml/seed.sqlite3 with provenance in
docs/eval-datasets.md; regenerate it with the documented harness command
rather than hand-editing it. The exported generation UUID is preserved
verbatim and differs per export.

Schema authority is ml/model.py; the DDL below mirrors it verbatim and the
verify step proves compatibility by loading the seed through
PaymentModelStore. Reproducibility: fixed fixture seed, fixed training order,
deterministic River updates, documented command. The `generation` UUID is
preserved verbatim from the training run, so two exports differ in that
identity marker only; the verify step proves decision-identity (identical
evaluate output on a probe set), which is the reproducibility claim.

Usage from the ml directory::

    uv run --with pyarrow --with pandas eval/harness.py --slice 5000 \\
        --export-seed /tmp/opencode/seed-ml.sqlite3

Standalone::

    python eval/seed_export.py export --src model.sqlite3 --dest seed.sqlite3
    python eval/seed_export.py verify --seed seed.sqlite3 --probe probe.json
"""

from __future__ import annotations

import argparse
import json
import os
import pickle
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
ML_DIR = EVAL_DIR.parent
sys.path.insert(0, str(ML_DIR))

# Mirrors ml/model.py table DDL verbatim. Compatibility is proven, not
# assumed: verify_seed loads the export through PaymentModelStore, which
# rejects corrupt or incompatible state at startup.
SCHEMA = (
    "CREATE TABLE IF NOT EXISTS model "
    "(id INTEGER PRIMARY KEY CHECK(id=1), generation TEXT NOT NULL, "
    "revision INTEGER NOT NULL, state BLOB NOT NULL)",
    "CREATE TABLE IF NOT EXISTS checkpoints "
    "(owner TEXT PRIMARY KEY, cursor TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS events "
    "(owner TEXT NOT NULL, event_id TEXT NOT NULL, fingerprint TEXT NOT NULL, "
    "PRIMARY KEY(owner, event_id))",
    "CREATE TABLE IF NOT EXISTS drift "
    "(id INTEGER PRIMARY KEY CHECK(id=1), pending INTEGER NOT NULL, "
    "warnings INTEGER NOT NULL, detections INTEGER NOT NULL)",
)


def export_seed(src: Path, dest: Path) -> dict:
    """Copy the model row; empty events/checkpoints; reset drift counters."""
    with sqlite3.connect(src) as db:
        row = db.execute(
            "SELECT generation, revision, state FROM model WHERE id=1"
        ).fetchone()
        if row is None:
            raise ValueError(f"no model row in {src}")
        generation, revision, state = row
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        dest.unlink()
    with sqlite3.connect(dest) as db:
        for statement in SCHEMA:
            db.execute(statement)
        with db:
            db.execute(
                "INSERT INTO model VALUES (1, ?, ?, ?)",
                (generation, revision, state),
            )
            db.execute("INSERT INTO drift VALUES (1, 0, 0, 0)")
    info = pickle.loads(state)
    return {
        "path": str(dest),
        "generation": generation,
        "revision": revision,
        "examples_seen": getattr(info, "examples_seen", None),
        "classification_counts": dict(
            getattr(info, "classification_counts", {})
        ),
        "note": "generation UUID preserved verbatim; identity marker only",
    }


def verify_seed(seed: Path, probe: Path) -> dict:
    """Load a copy of the seed fresh and evaluate the probe set identically."""
    with open(probe) as handle:
        probe_doc = json.load(handle)
    requests = probe_doc["requests"]
    expected = probe_doc["decisions"]
    with tempfile.TemporaryDirectory(prefix="seed-verify-") as tmp:
        copy = Path(tmp) / "seed-copy.sqlite3"
        shutil.copy(seed, copy)
        os.environ["ML_MODEL_PATH"] = str(copy)
        os.environ["ML_DRIFT_MODE"] = "auto"
        from model import PaymentModelStore

        store = PaymentModelStore()
        try:
            judgments = store.evaluate(requests)
        finally:
            store.close()
    got = [j.get("decision") for j in judgments]
    mismatched = [
        i for i, (g, w) in enumerate(zip(got, expected)) if g != w
    ]
    return {
        "probe_requests": len(requests),
        "matched": len(requests) - len(mismatched),
        "mismatched": mismatched[:10],
        "identical": not mismatched and len(got) == len(expected),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed export and verify")
    sub = parser.add_subparsers(dest="command", required=True)
    export = sub.add_parser("export")
    export.add_argument("--src", type=Path, required=True)
    export.add_argument("--dest", type=Path, required=True)
    verify = sub.add_parser("verify")
    verify.add_argument("--seed", type=Path, required=True)
    verify.add_argument("--probe", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "export":
        print(json.dumps(export_seed(args.src, args.dest), indent=2))
    else:
        print(json.dumps(verify_seed(args.seed, args.probe), indent=2))


if __name__ == "__main__":
    main()
