"""Go backend invocation and findings/request shaping for the training harness."""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
ML_DIR = EVAL_DIR.parent
REPO_ROOT = ML_DIR.parent
sys.path.insert(0, str(EVAL_DIR))

from datasets import BASE_DATE


def run_go_harness(
    fixture_path: Path, out_path: Path, months: int, seed: int
) -> dict:
    cmd = [
        "go",
        "run",
        "./cmd/testing/evalharness",
        "-fixture",
        str(fixture_path),
        "-out",
        str(out_path),
        "-months",
        str(months),
        "-seed",
        str(seed),
        "-base-date",
        BASE_DATE,
    ]
    started = time.perf_counter()
    proc = subprocess.run(cmd, cwd=REPO_ROOT / "backend", capture_output=True, text=True)
    elapsed = time.perf_counter() - started
    if proc.returncode != 0:
        raise RuntimeError(f"go harness failed: {proc.stderr[-4000:]}")
    with open(out_path) as handle:
        payload = json.load(handle)
    payload["_go_seconds"] = elapsed
    return payload


def category_requests_by_id(entries: list[dict]) -> dict[str, dict]:
    """Dedupe category entries to one training/eval item per request."""
    requests: dict[str, dict] = {}
    for entry in entries:
        req = entry.get("request") or {}
        request_id = req.get("id")
        if not request_id or request_id in requests:
            continue
        requests[request_id] = {
            "request": {
                "id": req["id"],
                "kind": req["kind"],
                "patternId": req["patternId"],
                "pattern": req["pattern"],
                "question": req["question"],
                "samples": req["samples"],
            },
            "kind": req["kind"],
            "signals": list((req.get("pattern") or {}).get("signals", [])),
            "transaction_ids": [],
            "expected": entry.get("expectedCategory", ""),
        }
    for entry in entries:
        req = entry.get("request") or {}
        item = requests.get(req.get("id", ""))
        if item is not None:
            item["transaction_ids"].append(entry.get("transactionId"))
    return requests


def findings_by_request(findings: list[dict]) -> dict[str, dict]:
    """Dedupe per-occurrence findings to one training/eval item per request."""
    requests: dict[str, dict] = {}
    for finding in findings:
        judged = finding.get("judgmentInput") or {}
        request_id = judged.get("id")
        if not request_id or request_id in requests:
            continue
        requests[request_id] = {
            "request": {
                "id": judged["id"],
                "kind": judged["kind"],
                "patternId": judged["patternId"],
                "pattern": judged["pattern"],
                "question": judged["question"],
                "samples": judged["samples"],
            },
            "kind": judged["kind"],
            "signals": list((judged.get("pattern") or {}).get("signals", [])),
            "transaction_ids": [],
        }
    for finding in findings:
        judged = finding.get("judgmentInput") or {}
        item = requests.get(judged.get("id", ""))
        if item is not None:
            item["transaction_ids"].append(finding.get("transactionId"))
    return requests
