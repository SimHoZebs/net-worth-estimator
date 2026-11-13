#!/usr/bin/env python3
"""Real-dataset evaluation harness for the payment-pattern pipeline.

Proves the pipeline on public data: downloads a labeled bank-descriptor
dataset, normalizes rows through the existing Go backend (grouping,
recurrence, signals, classifications), scores deterministic output against
dataset labels, trains the River learner (PaymentModelStore.state/evaluate/
observe only) to measure lift, runs experiment arms that isolate drift
diagnosis, and measures per-event train/eval latency plus peak RSS to
substantiate the online-learner volume claim.

Reads and writes only; never modifies model.py or server.py.
Run with the repo toolchain from the ml directory, e.g.::

    cd ml && uv run --with pyarrow --with pandas eval/harness.py --slice 5000

Layout: fixture JSON and findings JSON live under ml/eval/.cache/ (gitignored);
the learner uses a throwaway ML_MODEL_PATH under /tmp. Nothing is vendored
into the repo.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import resource
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
ML_DIR = EVAL_DIR.parent
REPO_ROOT = ML_DIR.parent
sys.path.insert(0, str(ML_DIR))

CACHE_DIR = EVAL_DIR / ".cache"
PARQUET_NAME = "us-bank-txn-cats-v2.parquet"
PARQUET_URL = (
    "https://huggingface.co/datasets/DoDataThings/us-bank-transaction-categories-v2"
    "/resolve/refs%2Fconvert%2Fparquet/default/train/0000.parquet"
)

# Dataset label -> detector kind ID. Labels without a classifier are omitted,
# meaning the correct outcome is no finding at all.
EXPECTED_KIND = {
    "Income": "income",
    "Rent": "rent",
    "Utilities": "utility",
    "Insurance": "auto-insurance",
}
MAPPED_KINDS = sorted(set(EXPECTED_KIND.values()))

# Dataset label -> category key (locked; mirrors the Go evalharness table).
# Transfer is direction-dependent (TRANSFER_IN on inflow, TRANSFER_OUT
# otherwise); labels without an entry carry no category expectation.
EXPECTED_CATEGORY = {
    "Income": "INCOME",
    "Rent": "RENT_AND_UTILITIES",
    "Utilities": "RENT_AND_UTILITIES",
    "Insurance": "GENERAL_SERVICES",
    "Mortgage": "LOAN_PAYMENTS",
    "Transfer": None,
    "Groceries": "FOOD_AND_DRINK",
    "Restaurants": "FOOD_AND_DRINK",
    "Shopping": "GENERAL_MERCHANDISE",
    "Transportation": "TRANSPORTATION",
    "Entertainment": "ENTERTAINMENT",
    "Subscription": "ENTERTAINMENT",
    "Healthcare": "MEDICAL",
    "Travel": "TRAVEL",
    "Education": "GENERAL_SERVICES",
    "Personal Care": "PERSONAL_CARE",
    "Fees": "BANK_FEES",
}

# Category keys with a dataset-mapped expectation, in display order.
# HOME_IMPROVEMENT and GOVERNMENT_AND_NON_PROFIT are exempt: no HF label
# maps to them, so they stay baseline until production feedback arrives.
CATEGORY_KINDS = [
    "INCOME", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "BANK_FEES",
    "ENTERTAINMENT", "FOOD_AND_DRINK", "GENERAL_MERCHANDISE",
    "MEDICAL", "PERSONAL_CARE", "GENERAL_SERVICES",
    "TRANSPORTATION", "TRAVEL", "RENT_AND_UTILITIES",
]

# Locked mitul label-to-category mapping (mirrors the Go evalharness table).
# Shopping & Retail rows matching the home-improvement pattern map to
# HOME_IMPROVEMENT; Entertainment & Recreation rows matching the gym pattern
# map to PERSONAL_CARE; Financial Services splits by key words (loan,
# insurance/tax, withdrawal) and every other Financial Services row DROPs
# (bare bank/investment names carry no mappable key). "Income" and
# "Transportation" collide with HF labels but map identically, so the scorer
# routes by label membership without ambiguity.
MITUL_HOME_RE = re.compile(r"\b(IKEA|HOME DEPOT|LOWES)\b", re.IGNORECASE)
MITUL_GYM_RE = re.compile(r"\b(GYM|FITNESS|PLANET FITNESS)\b", re.IGNORECASE)
MITUL_LOAN_RE = re.compile(r"\b(LOAN|MORTGAGE)\b", re.IGNORECASE)
MITUL_INS_RE = re.compile(r"\b(INSURANCE|TAX)\b", re.IGNORECASE)
MITUL_WD_RE = re.compile(r"WITHDRAWAL", re.IGNORECASE)

MITUL_LABELS = {
    "Food & Dining", "Transportation", "Shopping & Retail",
    "Entertainment & Recreation", "Healthcare & Medical",
    "Utilities & Services", "Financial Services", "Income",
    "Government & Legal", "Charity & Donations",
}

MITUL_PER_KEY = 4000


def resolve_expected_mitul(label: str, description: str) -> str:
    """Locked mitul label-to-category mapping; "" means DROP or unknown."""
    if label == "Food & Dining":
        return "FOOD_AND_DRINK"
    if label == "Transportation":
        return "TRANSPORTATION"
    if label == "Shopping & Retail":
        return (
            "HOME_IMPROVEMENT"
            if MITUL_HOME_RE.search(description)
            else "GENERAL_MERCHANDISE"
        )
    if label == "Entertainment & Recreation":
        return (
            "PERSONAL_CARE"
            if MITUL_GYM_RE.search(description)
            else "ENTERTAINMENT"
        )
    if label == "Healthcare & Medical":
        return "MEDICAL"
    if label == "Utilities & Services":
        return "RENT_AND_UTILITIES"
    if label == "Financial Services":
        if MITUL_LOAN_RE.search(description):
            return "LOAN_PAYMENTS"
        if MITUL_INS_RE.search(description):
            return "GENERAL_SERVICES"
        if MITUL_WD_RE.search(description):
            return "TRANSFER_OUT"
        return ""
    if label == "Income":
        return "INCOME"
    if label in ("Government & Legal", "Charity & Donations"):
        return "GOVERNMENT_AND_NON_PROFIT"
    return ""


def resolve_expected_category(label: str, direction: str) -> str:
    """Locked label-to-category mapping; Transfer follows the row direction."""
    if label == "Transfer":
        return "TRANSFER_IN" if direction == "inflow" else "TRANSFER_OUT"
    return EXPECTED_CATEGORY.get(label, "")

# Alias derivation: dataset categories whose merchants resolve to a provider
# signal through the real MapProviderResolver seam.
ALIAS_SIGNAL = {
    "Utilities": "utility-provider",
    "Insurance": "insurance-provider",
}

BASE_DATE = "2023-01-15"
SEED = 7

# paymentStreamText/paymentReferenceToken/recurringKey reduce a description to
# the first surviving token, so the alias key for a fixture row is the first
# token of length >= 3 that is not all digits, a reference token, or "dept".
# This mirrors backend/internal/analysis/recurring.go closely enough for exact
# MapProviderResolver keys; the harness reports the alias hit rate so any
# mismatch is visible instead of silent.
REFERENCE_TOKEN = re.compile(r"^(?:[a-z]{0,4}[0-9x]{4,}|[a-f0-9]{12,64})$")


def merchant_token(raw_description: str) -> str:
    text = raw_description
    for prefix in ("[debit]", "[credit]"):
        if text.startswith(prefix):
            text = text[len(prefix):]
            break
    # Trailing bank references never affect the first token; the domain-suffix
    # rule (brilliant.org -> brilliant) only splits tokens, which the generic
    # cleanup below already does.
    cleaned = re.sub(r"[^a-z0-9]", " ", text.lower())
    for token in cleaned.split():
        if len(token) < 3 or token.isdigit():
            continue
        if token == "dept" or REFERENCE_TOKEN.match(token):
            continue
        return token
    return ""


def download_parquet(cache: Path, url: str) -> Path:
    dest = cache / PARQUET_NAME
    if dest.exists():
        return dest
    cache.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(url) as response, open(tmp, "wb") as out:
        shutil.copyfileobj(response, out)
    tmp.rename(dest)
    return dest


def load_rows(parquet_path: Path) -> list[dict]:
    import pyarrow.parquet as pq

    table = pq.read_table(parquet_path, columns=["description", "category"])
    return [
        {"description": r["description"], "category": r["category"]}
        for r in table.to_pylist()
    ]


def sample_rows(rows: list[dict], count: int, seed: int) -> list[dict]:
    if count <= 0 or count >= len(rows):
        return list(rows)
    rng = random.Random(seed)
    by_category: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_category[row["category"]].append(row)
    per_cat = max(1, count // len(by_category))
    sampled: list[dict] = []
    for category in sorted(by_category):
        pool = by_category[category]
        rng.shuffle(pool)
        sampled.extend(pool[:per_cat])
    rng.shuffle(sampled)
    return sampled[:count]


def build_aliases(rows: list[dict]) -> list[dict]:
    aliases: dict[str, str] = {}
    for row in rows:
        signal = ALIAS_SIGNAL.get(row["category"])
        if not signal:
            continue
        token = merchant_token(row["description"])
        if token and token not in aliases:
            aliases[token] = signal
    return [{"match": m, "signal": s} for m, s in sorted(aliases.items())]


def load_moneydata(xlsx_path: Path) -> list[dict]:
    """MoneyData (Laramee, CC BY 4.0) rows mapped onto fixture schema.

    Real UK bank descriptions, real direction from the debit/credit
    columns; occurrence timing and amounts are still synthesized by the
    Go harness (documented limitation — this arm tests descriptor and
    label generalization, not timelines). Category is the mapped expected
    label so the Go expectedKinds and alias derivation work unchanged;
    mapped values are inert to source-category signals.
    """
    try:
        import openpyxl
    except ImportError as exc:
        raise SystemExit(
            "moneydata source needs openpyxl: uv run --with openpyxl ..."
        ) from exc
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["Anonymized Original with Catego"]
    header = [c.value for c in next(ws.rows)]
    col = {name: i for i, name in enumerate(header)}
    hints = [
        (("WATER", "ENERGY", "GAS", "VIRGIN MEDIA", "TALKTALK", "COUNC",
          "C.TAX", "TV LICENCE"), "Utilities"),
        (("LV LIFE", "ASSURANT", "ZURICH", "AVIVA", "LVFS"), "Insurance"),
        (("PRINCIPALITY", "NATWEST", "SANTANDER", "MORTGAGE",
          "DEZREZ"), "Mortgage"),
        (("PETER ALAN",), "Rent"),
        (("SWANSEA UNI", "UNIV OF NOTTINGHAM",
          "SWANSEA UNIVERSITY"), "Income"),
    ]
    rows = []
    for record in ws.iter_rows(min_row=2, values_only=True):
        raw_desc = record[col["Transaction Description"]]
        if raw_desc is None or (isinstance(raw_desc, float) and raw_desc != raw_desc):
            continue
        desc = str(raw_desc).strip()
        if not desc:
            continue
        debit = record[col["Debit Amount"]]
        credit = record[col["Credit Amount"]]
        if debit not in (None, ""):
            prefix = "[debit]"
        elif credit not in (None, ""):
            prefix = "[credit]"
        else:
            continue
        upper = desc.upper()
        label = ""
        for substrings, mapped in hints:
            if any(s in upper for s in substrings):
                label = mapped
                break
        rows.append({"description": f"{prefix} {desc}", "category": label})
    return rows


MONEYDATASET_ID = "Laramee MoneyData (Mendeley dnxtg6n4rv, CC BY 4.0)"


def load_mitul(parquet_path: Path, per_key: int = MITUL_PER_KEY,
                seed: int = SEED) -> list[dict]:
    """Mitul transaction-categorization rows mapped onto fixture schema.

    Clean merchant-name descriptions (no bank-statement noise, no direction
    markers, no amounts); the Go harness derives direction from the label
    (Income inflow, all others outflow) and drops Financial Services rows
    with no mappable key. Sampling is per mapped key over UNIQUE
    descriptions (per_key per key, fewer only when a key exhausts uniques),
    fixed seed, keys in sorted order. Currency rides along as-is.
    """
    import pyarrow.parquet as pq

    table = pq.read_table(
        parquet_path,
        columns=["transaction_description", "category", "currency"],
    )
    pool: dict[str, dict[str, tuple[str, str]]] = defaultdict(dict)
    for record in table.to_pylist():
        desc = (record["transaction_description"] or "").strip()
        if not desc:
            continue
        key = resolve_expected_mitul(record["category"], desc)
        if not key:
            continue
        if desc not in pool[key]:
            pool[key][desc] = (
                record["category"], record["currency"] or "USD",
            )
    rng = random.Random(seed)
    rows = []
    for key in sorted(pool):
        descs = sorted(pool[key])
        rng.shuffle(descs)
        for desc in descs[:per_key]:
            label, currency = pool[key][desc]
            rows.append({
                "description": desc,
                "category": label,
                "currency": currency,
            })
    return rows


def run_go_harness(
    fixture_path: Path, out_path: Path, months: int, seed: int
) -> dict:
    cmd = [
        "go",
        "run",
        "./cmd/evalharness",
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


def category_baseline_decision(request: dict) -> str:
    """Cold-start policy for one category request, mirroring evidence.py.

    support -> supported, candidate/suggest -> uncertain, exclude/missing ->
    unsupported. Only "supported" counts as a prediction when scoring.
    """
    question = request.get("question") or {}
    observed = set((request.get("pattern") or {}).get("signals", []))
    if set(question.get("requiredSignals") or []) - observed:
        return "unsupported"
    if observed.intersection(question.get("excludeSignals") or []):
        return "unsupported"
    if observed.intersection(question.get("supportSignals") or []):
        return "supported"
    if question.get("suggestWithoutSignal") or observed.intersection(
        question.get("candidateSignals") or []
    ):
        return "uncertain"
    return "unsupported"


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


def score_category_arm(
    transactions: list[dict], entries: list[dict]
) -> dict:
    """Score category requests against the locked label-to-category mapping.

    The deterministic cold-start baseline predicts exactly the kinds whose
    domain evidence supports them; uncertain and missing predictions count
    as wrong whenever an expectation exists. Pair-counted per key, with a
    strict exact-predicted-set top-level accuracy like score_arm.
    """
    info = {t["id"]: t for t in transactions}
    for entry in entries:
        stem = entry.get("transactionId", "")
        row = info.get(stem)
        if row is None:
            raise ValueError(f"category entry links unknown transaction {stem}")
        if row["category"] in MITUL_LABELS:
            locked = resolve_expected_mitul(row["category"], row["description"])
        else:
            locked = resolve_expected_category(row["category"], row["direction"])
        if row.get("expectedCategory") != locked or entry.get("expectedCategory") != locked:
            raise ValueError(
                f"category mapping drift on {stem}: label={row['category']} "
                f"direction={row['direction']} go={row.get('expectedCategory')!r} "
                f"entry={entry.get('expectedCategory')!r} locked={locked!r}"
            )
    expected = {t["id"]: t.get("expectedCategory", "") for t in transactions}
    predicted: dict[str, set[str]] = defaultdict(set)
    for entry in entries:
        if category_baseline_decision(entry.get("request") or {}) == "supported":
            kind = (entry.get("request") or {}).get("kind", "")
            if kind.startswith("category:"):
                predicted[entry.get("transactionId", "")].add(kind[len("category:"):])
    kinds = CATEGORY_KINDS + ["none"]
    confusion = {e: {p: 0 for p in kinds} for e in kinds}
    for stem, want in expected.items():
        got = predicted.get(stem, set())
        want_key = want if want in CATEGORY_KINDS else "none"
        if not got:
            confusion[want_key]["none"] += 1
        for kind in got:
            confusion[want_key][kind if kind in kinds else "none"] += 1
    per_kind = {}
    for kind in CATEGORY_KINDS:
        tp = confusion[kind][kind]
        fp = sum(confusion[e][kind] for e in kinds if e != kind)
        fn = sum(confusion[kind][p] for p in kinds if p != kind)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        per_kind[kind] = {
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "precision": precision,
            "recall": recall,
            "f1": (
                2 * precision * recall / (precision + recall)
                if precision + recall
                else 0.0
            ),
        }
    none_expected = sum(1 for w in expected.values() if w not in CATEGORY_KINDS)
    none_clean = confusion["none"]["none"]
    return {
        "transactions": len(expected),
        "entries": len(entries),
        "per_kind": per_kind,
        "confusion": confusion,
        "none_expected": none_expected,
        "none_clean": none_clean,
        "none_clean_rate": (none_clean / none_expected) if none_expected else 1.0,
        "accuracy": sum(
            1
            for stem, want in expected.items()
            if (predicted.get(stem, set()) == {want} if want in CATEGORY_KINDS else not predicted.get(stem))
        )
        / len(expected),
    }


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


def score_arm(
    transactions: list[dict], findings: list[dict]
) -> dict:
    """Score one arm's findings against dataset labels.

    Pair-counted: a transaction predicted with several kinds contributes one
    confusion pair per predicted kind, so a partially-correct multi-prediction
    counts as a TP for the right kind plus FP/FN for the extra kinds. The
    top-level accuracy is stricter: exact predicted-set match only.
    """
    expected = {t["id"][: len("eval-000000")]: t["expectedKind"] for t in transactions}
    predicted: dict[str, set[str]] = defaultdict(set)
    strength: dict[str, dict[str, int]] = defaultdict(lambda: {"strong": 0, "moderate": 0})
    for finding in findings:
        stem = (finding.get("transactionId") or "")[: len("eval-000000")]
        predicted[stem].add(finding.get("kind"))
        # Deterministic "strong" means the detector supported the finding on
        # its own evidence; "moderate" covers uncertain candidates (and
        # judgment-backed moderates). A policy demotion (support -> candidate)
        # shows up here as strong -> moderate migration with recall unchanged.
        cell = strength[expected.get(stem) or "none"]
        cell["strong" if finding.get("strength") == "strong" else "moderate"] += 1
    kinds = MAPPED_KINDS + ["none"]
    confusion = {e: {p: 0 for p in kinds} for e in kinds}
    for stem, want in expected.items():
        got = predicted.get(stem, set())
        want_key = want or "none"
        if not got:
            confusion[want_key]["none"] += 1
        for kind in got:
            confusion[want_key][kind if kind in kinds else "none"] += 1
    per_kind = {}
    for kind in MAPPED_KINDS:
        tp = confusion[kind][kind]
        fp = sum(confusion[e][kind] for e in kinds if e != kind)
        fn = sum(confusion[kind][p] for p in kinds if p != kind)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        per_kind[kind] = {
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "precision": precision,
            "recall": recall,
            "f1": (
                2 * precision * recall / (precision + recall)
                if precision + recall
                else 0.0
            ),
        }
    none_expected = sum(1 for w in expected.values() if not w)
    none_clean = confusion["none"]["none"]
    return {
        "strength": {e: strength.get(e, {"strong": 0, "moderate": 0}) for e in kinds},
        "transactions": len(expected),
        "findings": len(findings),
        "per_kind": per_kind,
        "confusion": confusion,
        "none_expected": none_expected,
        "none_clean": none_clean,
        "none_clean_rate": (none_clean / none_expected) if none_expected else 1.0,
        "accuracy": sum(
            1
            for stem, want in expected.items()
            if (predicted.get(stem, set()) == {want} if want else not predicted.get(stem))
        )
        / len(expected),
    }


def signal_support_share(requests: dict[str, dict]) -> dict[str, dict]:
    """Share of requests carrying domain support vs hint-only signals.

    A request is hint-only when every observed signal is a candidate/hint
    (regular-cadence, source-income, source-rent) with no descriptor or
    provider backing. Hint-only requests are fragile by construction: policy
    changes that demote a hint move them between supported and uncertain
    without any descriptor evidence changing. This split quantifies that.
    """
    HINT_ONLY = {"regular-cadence", "source-income", "source-rent"}
    out: dict[str, dict] = {}
    for kind in MAPPED_KINDS:
        items = [r for r in requests.values() if r["kind"] == kind]
        hint_only = sum(
            1 for r in items if set(r["signals"]) <= HINT_ONLY
        )
        out[kind] = {
            "requests": len(items),
            "with_descriptor_signal": len(items) - hint_only,
            "source_only": hint_only,
        }
    return out


def alias_hit_rate(output: dict) -> dict:
    base_signals: dict[str, set[str]] = {}
    for finding in output["findings"]["baseline"]:
        judged = finding.get("judgmentInput") or {}
        base_signals.setdefault(judged.get("id", ""), set(judged.get("pattern", {}).get("signals", [])))
    hits = total = 0
    per_kind: dict[str, dict] = {}
    for finding in output["findings"]["providers"]:
        judged = finding.get("judgmentInput") or {}
        # Only utility/insurance merchants carry alias entries; income and
        # rent resolve through descriptor/bank-hint signals by design.
        if judged.get("kind") not in ("utility", "auto-insurance"):
            continue
        request_id = judged.get("id", "")
        new_signals = set(judged.get("pattern", {}).get("signals", [])) - base_signals.get(
            request_id, set()
        )
        total += 1
        hit = any(s.endswith("-provider") or s == "card-issuer" for s in new_signals)
        hits += int(hit)
        cell = per_kind.setdefault(judged.get("kind"), {"findings": 0, "hits": 0})
        cell["findings"] += 1
        cell["hits"] += int(hit)
    return {"findings": total, "with_new_provider_signal": hits,
            "hit_rate": (hits / total) if total else 0.0,
            "per_kind": per_kind}


class LearnerRun:
    """Thin timing/drift wrapper around the stable PaymentModelStore API."""

    def __init__(self, keep: bool = False) -> None:
        # Imported lazily so fixture building and Go scoring work even when
        # the learner dependency is unavailable.
        from model import PaymentModelStore

        self._dir = Path(tempfile.mkdtemp(prefix="eval-ml-"))
        self._keep = keep
        os.environ["ML_MODEL_PATH"] = str(self._dir / "model.sqlite3")
        # Respect a pre-set mode (the seed recipe opts into manual); every
        # other caller gets today's auto behavior.
        os.environ.setdefault("ML_DRIFT_MODE", "auto")
        self.store = PaymentModelStore()
        self.train_ms: list[float] = []
        self.eval_ms: list[float] = []
        self._event_count: dict[str, int] = defaultdict(int)

    def close(self) -> None:
        self.store.close()
        if not self._keep:
            shutil.rmtree(self._dir, ignore_errors=True)

    @property
    def db_path(self) -> Path:
        return self._dir / "model.sqlite3"

    def drift(self, owner: str) -> dict:
        return self.store.state(owner)["drift"]

    def dismiss(self) -> dict:
        """Operator-equivalent dismiss for recipe use: restart only the
        ADWIN window, keep weights and counts."""
        return self.store.dismiss_drift()

    def evaluate_timed(self, requests: list[dict]) -> list[dict]:
        started = time.perf_counter()
        try:
            return self.store.evaluate(requests)
        finally:
            self.eval_ms.append(
                (time.perf_counter() - started) * 1000 / max(1, len(requests))
            )

    def observe_batches(
        self,
        owner: str,
        items: list[tuple[dict, str]],
        run_id: str,
        probe_requests: list[dict] | None = None,
        probe_actions: list[str] | None = None,
        dismiss_trips: bool = False,
    ) -> list[dict]:
        """Feed items in <=200 batches; optionally score a probe set per batch.

        The trajectory records (batch, probe accuracy, cumulative detections)
        so learning-curve movement can be separated from real drift trips.
        With dismiss_trips, a manual-mode drift trip dismisses the detector
        (weights kept) and retries the batch once instead of aborting; if
        the retried batch trips again, it is halved and each half retried
        the same way, down to 25 events — a shift inside one transport
        batch must not abort a fixed-label curriculum, and no event is
        ever skipped. Any other failure, or a trip on a <=25 span, raises.
        """
        from model import ConflictError

        trajectory = []
        if not items:
            return trajectory
        cursor = self.store.state(owner)["cursor"]
        spans = [(0, len(items))]
        while spans:
            start, end = spans.pop(0)
            if end - start > 200:
                spans.insert(0, (start + 200, end))
                end = start + 200
            batch = items[start:end]
            feedback = []
            for request, action in batch:
                self._event_count[owner] += 1
                event_id = f"{owner}-ev-{self._event_count[owner]:07d}"
                feedback.append(
                    {
                        "action": action,
                        "eventId": event_id,
                        "runId": run_id,
                        "request": request,
                    }
                )
            after, cursor = cursor, feedback[-1]["eventId"]
            started = time.perf_counter()
            try:
                try:
                    self.store.observe(owner, after, cursor, feedback)
                except ConflictError as exc:
                    if not (
                        dismiss_trips and "drift detected" in str(exc)
                    ):
                        raise
                    print(
                        f"eval: drift trip on batch {start // 200}, "
                        f"dismissing detector and retrying",
                        flush=True,
                    )
                    self.dismiss()
                    try:
                        self.store.observe(owner, after, cursor, feedback)
                    except ConflictError as retry_exc:
                        if "drift detected" not in str(retry_exc):
                            raise
                        if end - start <= 25:
                            raise
                        print(
                            f"eval: batch {start // 200} tripped again, "
                            f"splitting {end - start} events",
                            flush=True,
                        )
                        self.dismiss()
                        mid = start + (end - start) // 2
                        spans.insert(0, (mid, end))
                        spans.insert(0, (start, mid))
                        # The tripping batch committed nothing, so the
                        # checkpoint still precedes it; rewind the cursor
                        # and the event counter past its uncommitted events.
                        cursor = after
                        self._event_count[owner] -= len(feedback)
                        continue
            finally:
                self.train_ms.append(
                    (time.perf_counter() - started) * 1000 / max(1, len(feedback))
                )
            if probe_requests:
                judgments = self.store.evaluate(probe_requests)
                acc = decision_accuracy(judgments, probe_actions or [])
                trajectory.append(
                    {
                        "batch": start // 200,
                        "events": self._event_count[owner],
                        "probe_accuracy": acc["accuracy"],
                        "decisive_rate": acc["decisive_rate"],
                        "detections": self.drift(owner)["detections"],
                    }
                )
        return trajectory


def order_requests(
    requests: dict[str, dict], expected_by_request: dict[str, str], mode: str
) -> list[tuple[dict, str]]:
    items = []
    for request_id, item in requests.items():
        want = expected_by_request.get(request_id, "")
        action = "confirm" if want and want == item["kind"] else "reject"
        items.append((item["request"], action, item["kind"], request_id))
    if mode == "sequential":
        items.sort(key=lambda t: (t[2], t[3]))
    elif mode == "interleaved":
        buckets: dict[str, list] = defaultdict(list)
        for entry in sorted(items, key=lambda t: t[3]):
            buckets[entry[2]].append(entry)
        items = []
        while any(buckets.values()):
            for kind in sorted(buckets):
                if buckets[kind]:
                    items.append(buckets[kind].pop(0))
    else:
        raise ValueError(f"unknown order {mode}")
    return [(request, action) for request, action, _, _ in items]


def expected_by_request(
    requests: dict[str, dict], expected_by_stem: dict[str, str]
) -> dict[str, str]:
    out = {}
    for request_id, item in requests.items():
        wants = {
            expected_by_stem.get(tx_id[: len("eval-000000")], "")
            for tx_id in item["transaction_ids"]
        }
        out[request_id] = next(iter(wants)) if len(wants) == 1 else ""
    return out


def decision_accuracy(
    judgments: list[dict], actions: list[str]
) -> dict:
    want = ["supported" if a == "confirm" else "unsupported" for a in actions]
    got = [j.get("decision") for j in judgments]
    correct = sum(1 for g, w in zip(got, want) if g == w)
    decisive = sum(1 for g in got if g != "uncertain")
    return {
        "total": len(want),
        "correct": correct,
        "accuracy": (correct / len(want)) if want else 0.0,
        "decisive_rate": (decisive / len(want)) if want else 0.0,
        "decision_counts": dict(Counter(got)),
    }


def _evaluate_all(learner: LearnerRun, requests: list[dict]) -> list[dict]:
    """Score every request; the learner bounds a single evaluate call."""
    judgments: list[dict] = []
    for start in range(0, len(requests), 5000):
        judgments.extend(learner.evaluate_timed(requests[start : start + 5000]))
    return judgments


def run_arm(
    name: str,
    arm_requests: dict[str, dict],
    ordered: list[tuple[dict, str]],
) -> dict:
    learner = LearnerRun()
    owner = f"eval-{name}"
    try:
        requests = [request for request, _ in ordered]
        actions = [action for _, action in ordered]
        # The learner bounds one evaluate call; large arms score in chunks.
        pre = decision_accuracy(_evaluate_all(learner, requests), actions)
        drift_before = learner.drift(owner)
        probe_requests = requests[:100]
        probe_actions = actions[:100]
        trajectory = learner.observe_batches(
            owner, ordered, run_id=f"{name}-run",
            probe_requests=probe_requests, probe_actions=probe_actions,
        )
        drift_after = learner.drift(owner)
        post = decision_accuracy(_evaluate_all(learner, requests), actions)
        peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
        train = sorted(learner.train_ms)
        ev = sorted(learner.eval_ms)
        pct = lambda xs, q: xs[min(len(xs) - 1, int(q * len(xs)))] if xs else 0.0
        return {
            "name": name,
            "events": len(ordered),
            "unique_requests": len(arm_requests),
            "pre": pre,
            "post": post,
            "lift": post["accuracy"] - pre["accuracy"],
            "drift_before": drift_before,
            "drift_after": drift_after,
            "trips": drift_after["detections"] - drift_before["detections"],
            "warnings": drift_after["warnings"] - drift_before["warnings"],
            "train_per_event_ms": {
                "median": pct(train, 0.5),
                "p90": pct(train, 0.9),
                "max": max(train) if train else 0.0,
            },
            "eval_per_event_ms": {
                "median": pct(ev, 0.5),
                "p90": pct(ev, 0.9),
                "max": max(ev) if ev else 0.0,
            },
            "peak_rss_mb": peak_mb,
            "trajectory": trajectory,
        }
    finally:
        learner.close()


def run_shift_probe(ordered: list[tuple[dict, str]]) -> dict:
    """Synthetic abrupt-shift probe: agree, then contradict, on a fresh store.

    Feeds flipped labels after convergence so the ADWIN trip path and its
    accuracy cost are exercised even when the real-label arms stay quiet.
    Labels here are synthetic by construction, never dataset evidence.
    """
    learner = LearnerRun()
    owner = "eval-shift-probe"
    try:
        n = len(ordered)
        if n < 10:
            return {"skipped": f"only {n} events, need >= 10"}
        agree = ordered[: 3 * n // 5]
        held_out = ordered[3 * n // 5 : 4 * n // 5] or ordered[3 * n // 5 :]
        flipped = [
            (request, "reject" if action == "confirm" else "confirm")
            for request, action in ordered[3 * n // 5 :]
        ]
        probe_requests = [request for request, _ in held_out]
        probe_actions = [action for _, action in held_out]
        learner.observe_batches(owner, agree, run_id="probe-agree")
        before = decision_accuracy(
            learner.evaluate_timed(probe_requests), probe_actions
        )
        drift_mid = learner.drift(owner)
        learner.observe_batches(owner, flipped, run_id="probe-flip")
        after = decision_accuracy(
            learner.evaluate_timed(probe_requests), probe_actions
        )
        drift_end = learner.drift(owner)
        return {
            "agree_events": len(agree),
            "flip_events": len(flipped),
            "probe_requests": len(held_out),
            "accuracy_before_flip": before["accuracy"],
            "accuracy_after_flip": after["accuracy"],
            "accuracy_delta": after["accuracy"] - before["accuracy"],
            "detections_during_flip": (
                drift_end["detections"] - drift_mid["detections"]
            ),
            "warnings_during_flip": drift_end["warnings"] - drift_mid["warnings"],
        }
    finally:
        learner.close()


def run_seed_recipe(
    ordered_lists: list[tuple[str, list[tuple[dict, str]]]],
    seed_path: Path,
    probe_path: Path,
    cat_ordered_lists: list[tuple[str, list[tuple[dict, str]]]] = (),
    min_per_kind: int = 50,
) -> dict:
    """Canonical seed recipe: concatenated sources, manual drift mode.

    Trains every source's interleaved payment baseline order in sequence,
    then every source's interleaved category order (HF descriptors, then
    MoneyData timelines, then mitul descriptors), dismissing the detector
    and retrying on drift trips so one shift never wipes the seed. Exports a database with ONLY
    the model row and fails loudly unless every payment classifier kind
    and every mapped category kind clears the coverage minimum — a seed
    that leaves a kind cold is worse than no seed. HOME_IMPROVEMENT and
    GOVERNMENT_AND_NON_PROFIT are exempt by policy (no HF/MoneyData label
    maps to them; the mitul arm warms them but they stay baseline until
    production feedback).
    """
    from seed_export import export_seed, verify_seed

    previous_mode = os.environ.get("ML_DRIFT_MODE")
    os.environ["ML_DRIFT_MODE"] = "manual"
    ordered: list[tuple[dict, str]] = []
    for _, items in ordered_lists:
        ordered.extend(items)
    cat_ordered: list[tuple[dict, str]] = []
    for _, items in cat_ordered_lists:
        cat_ordered.extend(items)
    learner = LearnerRun(keep=True)
    try:
        learner.observe_batches(
            "eval-seed", ordered, run_id="seed-run", dismiss_trips=True
        )
        learner.observe_batches(
            "eval-seed", cat_ordered, run_id="seed-cat-run", dismiss_trips=True
        )
        counts = _model_counts(learner.db_path)
        short = {
            k: counts.get(k, 0)
            for k in sorted(set(MAPPED_KINDS) | set(counts))
        }
        missing = [k for k in MAPPED_KINDS if counts.get(k, 0) < min_per_kind]
        cat_short = {
            f"category:{k}": counts.get(f"category:{k}", 0)
            for k in CATEGORY_KINDS
        }
        missing_cat = [
            k for k in CATEGORY_KINDS
            if counts.get(f"category:{k}", 0) < min_per_kind
        ]
        if missing or missing_cat:
            raise ValueError(
                f"seed coverage gate failed (minimum {min_per_kind} per kind): "
                f"{short} {cat_short}"
            )
        probe_requests = [request for request, _ in ordered[:200]]
        probe_requests += [request for request, _ in cat_ordered[:200]]
        for tag, items in cat_ordered_lists:
            if tag == "mitul":
                probe_requests += [request for request, _ in items[:200]]
                break
        in_memory = learner.evaluate_timed(probe_requests)
        with open(probe_path, "w") as handle:
            json.dump(
                {
                    "recipe": "multi-source baseline findings, manual mode",
                    "requests": probe_requests,
                    "decisions": [j.get("decision") for j in in_memory],
                },
                handle,
            )
        info = export_seed(learner.db_path, seed_path)
        verification = verify_seed(seed_path, probe_path)
        drift = learner.drift("eval-seed")
        return {
            "recipe": "multi-source baseline findings, manual mode",
            "events": len(ordered) + len(cat_ordered),
            "payment_events": len(ordered),
            "category_events": len(cat_ordered),
            "coverage_counts": short,
            "category_coverage_counts": cat_short,
            "export": info,
            "probe_path": str(probe_path),
            "probe_requests": len(probe_requests),
            "verification": verification,
            "drift_at_export": drift,
        }
    finally:
        if previous_mode is None:
            os.environ.pop("ML_DRIFT_MODE", None)
        else:
            os.environ["ML_DRIFT_MODE"] = previous_mode
        learner.close()
        shutil.rmtree(learner._dir, ignore_errors=True)


def _model_counts(db_path: Path) -> dict:
    """Read per-kind training counts straight from a model row."""
    import pickle
    import sqlite3

    with sqlite3.connect(db_path) as db:
        row = db.execute("SELECT state FROM model WHERE id=1").fetchone()
    if row is None:
        return {}
    state = pickle.loads(row[0])
    return dict(getattr(state, "classification_counts", {}) or {})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Real-dataset eval harness")
    parser.add_argument("--slice", type=int, default=5000,
                        help="rows to sample (stratified, fixed seed)")
    parser.add_argument("--full", action="store_true",
                        help="use all 68k rows instead of --slice")
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--months", type=int, default=6)
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--export-seed", type=Path, default=None,
                        help="export a seed learner DB to this path (outside the repo)")
    parser.add_argument("--seed-probe", type=Path, default=None,
                        help="write the seed verification probe set here")
    parser.add_argument("--source", choices=("hf-v2", "moneydata", "mitul", "all"),
                        default="hf-v2",
                        help="dataset source (default: hf-v2)")
    parser.add_argument("--moneydata-path", type=Path, default=None,
                        help="Laramee MoneyData xlsx (required for moneydata/all)")
    parser.add_argument("--mitul-path", type=Path, default=None,
                        help="mitul transaction-categorization parquet (required for mitul/all)")
    return parser.parse_args()


def run_source(args, cache: Path, tag: str, rows: list[dict],
               source_label: str, source_license: str) -> tuple[dict, list, list]:
    """One full eval pass for a dataset; returns (report, seed_ordered, cat_seed_ordered).

    seed_ordered is the interleaved payment baseline (request, action) list
    and cat_seed_ordered the interleaved category (request, action) list for
    the combined seed phase. Report filenames are suffixed per source so a
    combined run never clobbers single-source outputs.
    """
    suffix = "" if tag == "hf-v2" else f"-{tag}"
    label_counts = Counter(r["category"] for r in rows)
    # The mitul arm is descriptor breadth only: one representative occurrence
    # per row, no payment-series synthesis.
    months = 1 if tag == "mitul" else args.months
    if args.full or tag == "mitul":
        sampled = list(rows)
    else:
        sampled = sample_rows(rows, args.slice, args.seed)
    aliases = build_aliases(sampled)

    fixture_path = cache / f"fixture{suffix}.json"
    with open(fixture_path, "w") as handle:
        json.dump(
            {
                "meta": {
                    "source": source_label,
                    "rows": len(sampled),
                    "seed": args.seed,
                    "months": months,
                    "baseDate": BASE_DATE,
                },
                "aliases": aliases,
                "rows": sampled,
            },
            handle,
        )
    findings_path = cache / f"findings{suffix}.json"
    output = run_go_harness(fixture_path, findings_path, months, args.seed)
    transactions = output["transactions"]

    arms_output = {}
    for arm in ("baseline", "providers"):
        arms_output[arm] = score_arm(transactions, output["findings"][arm])
    support = {
        arm: signal_support_share(findings_by_request(output["findings"][arm]))
        for arm in ("baseline", "providers")
    }
    alias_hits = alias_hit_rate(output)

    expected_by_stem = {
        t["id"][: len("eval-000000")]: t["expectedKind"] for t in transactions
    }
    learner_arms = {}
    arm_specs = [
        ("desc-interleaved", "baseline", "interleaved"),
        ("desc-sequential", "baseline", "sequential"),
        ("prov-interleaved", "providers", "interleaved"),
        ("prov-sequential", "providers", "sequential"),
    ]
    for name, findings_arm, order in arm_specs:
        requests = findings_by_request(output["findings"][findings_arm])
        ordered = order_requests(
            requests, expected_by_request(requests, expected_by_stem), order
        )
        learner_arms[name] = run_arm(f"{tag}-{name}", requests, ordered)
    probe_ordered = order_requests(
        findings_by_request(output["findings"]["baseline"]),
        expected_by_request(
            findings_by_request(output["findings"]["baseline"]),
            expected_by_stem,
        ),
        "interleaved",
    )
    probe = run_shift_probe(probe_ordered)

    seed_ordered = order_requests(
        findings_by_request(output["findings"]["baseline"]),
        expected_by_request(
            findings_by_request(output["findings"]["baseline"]),
            expected_by_stem,
        ),
        "interleaved",
    )

    cat_entries = output["findings"].get("categoryRequests", [])
    cat_scored = score_category_arm(transactions, cat_entries)
    cat_requests = category_requests_by_id(cat_entries)
    cat_expected_by_request = {
        request_id: (f"category:{item['expected']}" if item["expected"] else "")
        for request_id, item in cat_requests.items()
    }
    cat_learner_arms = {}
    for name, order in (("cat-interleaved", "interleaved"),
                        ("cat-sequential", "sequential")):
        cat_ordered = order_requests(cat_requests, cat_expected_by_request, order)
        cat_learner_arms[name] = run_arm(f"{tag}-{name}", cat_requests, cat_ordered)
    cat_seed_ordered = order_requests(
        cat_requests, cat_expected_by_request, "interleaved"
    )
    report = {
        "dataset": {
            "source": source_label,
            "license": source_license,
            "total_rows": len(rows),
            "label_counts": dict(sorted(label_counts.items())),
            "sampled_rows": len(sampled),
            "full": bool(args.full),
            "seed": args.seed,
            "months": months,
            "base_date": BASE_DATE,
        },
        "go_seconds": output["_go_seconds"],
        "go_transactions": output["meta"]["transactions"],
        "alias_table_size": len(aliases),
        "alias_hit_rate": alias_hits,
        "deterministic": arms_output,
        "category_deterministic": cat_scored,
        "signal_support": support,
        "learner": learner_arms,
        "category_learner": cat_learner_arms,
        "shift_probe": probe,
        "seed": None,
    }
    report_path = args.report or (cache / f"report{suffix}.json")
    with open(report_path, "w") as handle:
        json.dump(report, handle, indent=2)
    print(f"### source: {tag}")
    print_summary(report)
    return report, seed_ordered, cat_seed_ordered


def main() -> None:
    args = parse_args()
    cache = args.cache_dir
    cache.mkdir(parents=True, exist_ok=True)

    tags = ("hf-v2", "moneydata", "mitul") if args.source == "all" else (args.source,)
    seed_inputs: list[tuple[str, list]] = []
    cat_seed_inputs: list[tuple[str, list]] = []
    for tag in tags:
        if tag == "hf-v2":
            parquet_path = download_parquet(cache, PARQUET_URL)
            rows = load_rows(parquet_path)
            source_label = "DoDataThings/us-bank-transaction-categories-v2"
            source_license = "MIT"
        elif tag == "mitul":
            if args.mitul_path is None:
                raise SystemExit("--mitul-path is required for mitul/all (gated download, never vendored)")
            rows = load_mitul(args.mitul_path, seed=args.seed)
            source_label = "mitulshah/transaction-categorization"
            source_license = "gated (local copy; see README)"
        else:
            if args.moneydata_path is None:
                raise SystemExit("--moneydata-path is required for moneydata")
            rows = load_moneydata(args.moneydata_path)
            source_label = MONEYDATASET_ID
            source_license = "CC BY 4.0 (citation required, see README)"
        _, seed_ordered, cat_seed_ordered = run_source(args, cache, tag, rows,
                                     source_label, source_license)
        # The mitul arm runs a single representative occurrence per row, so
        # its payment findings carry no recurrence signal and stay out of
        # the seed; only its category order trains.
        if tag != "mitul":
            seed_inputs.append((tag, seed_ordered))
        cat_seed_inputs.append((tag, cat_seed_ordered))

    if args.export_seed is not None:
        probe_path = args.seed_probe or (cache / "seed-probe.json")
        seed = run_seed_recipe(seed_inputs, args.export_seed, probe_path,
                               cat_ordered_lists=cat_seed_inputs)
        print("### combined seed")
        print(json.dumps(
            {"events": seed["events"],
             "payment_events": seed["payment_events"],
             "category_events": seed["category_events"],
             "coverage_counts": seed["coverage_counts"],
             "category_coverage_counts": seed["category_coverage_counts"],
             "verification": seed["verification"],
             "drift_at_export": seed["drift_at_export"]}, indent=2))


def print_learner_arm(name: str, arm: dict) -> None:
    print(
        f"  {name:18s} events={arm['events']} "
        f"pre={arm['pre']['accuracy']:.4f} post={arm['post']['accuracy']:.4f} "
        f"lift={arm['lift']:+.4f} trips={arm['trips']} warnings={arm['warnings']} "
        f"train_ms/event med={arm['train_per_event_ms']['median']:.3f} "
        f"p90={arm['train_per_event_ms']['p90']:.3f} "
        f"eval_ms/event med={arm['eval_per_event_ms']['median']:.3f} "
        f"peak_rss_mb={arm['peak_rss_mb']:.1f}"
    )
    print(
        f"    pre_decisions={arm['pre']['decision_counts']} "
        f"decisive={arm['pre']['decisive_rate']:.3f} | "
        f"post_decisions={arm['post']['decision_counts']} "
        f"decisive={arm['post']['decisive_rate']:.3f}"
    )
    print(
        f"    trajectory(batch:probe_acc/decisive/detections): "
        + " ".join(
            f"{t['batch']}:{t['probe_accuracy']:.3f}/{t['decisive_rate']:.3f}/{t['detections']}"
            for t in arm.get("trajectory", [])
        )
    )


def print_summary(report: dict) -> None:
    print("# Real-dataset eval report\n")
    ds = report["dataset"]
    print(
        f"Dataset {ds['source']} ({ds['license']}): "
        f"{ds['sampled_rows']}/{ds['total_rows']} rows, "
        f"{ds['months']} synthetic months each, "
        f"Go stage {report['go_seconds']:.1f}s for {report['go_transactions']} transactions."
    )
    print(
        f"Alias table: {report['alias_table_size']} entries, "
        f"provider-signal hit rate {report['alias_hit_rate']['hit_rate']:.3f} "
        f"({report['alias_hit_rate']['with_new_provider_signal']}/"
        f"{report['alias_hit_rate']['findings']} alias-covered findings; "
        f"per-kind {report['alias_hit_rate']['per_kind']})."
    )
    for arm, scored in report["deterministic"].items():
        print(f"\n## Deterministic arm: {arm}")
        print(
            f"transactions={scored['transactions']} findings={scored['findings']} "
            f"overall_accuracy={scored['accuracy']:.4f} "
            f"expected-none clean {scored['none_clean']}/{scored['none_expected']} "
            f"({scored['none_clean_rate']:.4f})"
        )
        for kind in MAPPED_KINDS:
            m = scored["per_kind"][kind]
            print(
                f"  {kind:15s} P={m['precision']:.4f} R={m['recall']:.4f} "
                f"F1={m['f1']:.4f} (tp={m['tp']} fp={m['fp']} fn={m['fn']})"
            )
        print("  confusion rows expected -> predicted " + "/".join(MAPPED_KINDS + ["none"]))
        for exp in MAPPED_KINDS + ["none"]:
            cells = " ".join(
                f"{p}={scored['confusion'][exp][p]}" for p in MAPPED_KINDS + ["none"]
            )
            print(f"    {exp:15s} {cells}")
    print("\n## Signal support (backed vs hint-only requests)")
    for arm, kinds in report["signal_support"].items():
        for kind, share in kinds.items():
            print(
                f"  {arm}/{kind}: requests={share['requests']} "
                f"backed={share['with_descriptor_signal']} "
                f"hint-only={share['source_only']}"
            )
    print("\n## Strength split (strong = detector-supported, moderate = candidate)")
    for arm, scored in report["deterministic"].items():
        cells = " ".join(
            f"{e}={scored['strength'][e]['strong']}s/{scored['strength'][e]['moderate']}m"
            for e in MAPPED_KINDS + ["none"]
        )
        print(f"  {arm}: {cells}")
    scored = report["category_deterministic"]
    print("\n## Deterministic category arm (cold-start keyword policy)")
    print(
        f"transactions={scored['transactions']} entries={scored['entries']} "
        f"overall_accuracy={scored['accuracy']:.4f} "
        f"expected-none clean {scored['none_clean']}/{scored['none_expected']} "
        f"({scored['none_clean_rate']:.4f})"
    )
    for kind in CATEGORY_KINDS:
        m = scored["per_kind"][kind]
        print(
            f"  {kind:22s} P={m['precision']:.4f} R={m['recall']:.4f} "
            f"F1={m['f1']:.4f} (tp={m['tp']} fp={m['fp']} fn={m['fn']})"
        )
    print("  confusion rows expected -> predicted " + "/".join(CATEGORY_KINDS + ["none"]))
    for exp in CATEGORY_KINDS + ["none"]:
        cells = " ".join(
            f"{p}={scored['confusion'][exp][p]}" for p in CATEGORY_KINDS + ["none"]
        )
        print(f"    {exp:22s} {cells}")
    print("\n## Learner arms (fresh store each; strict accuracy, uncertain counts as wrong)")
    for name, arm in report["learner"].items():
        print_learner_arm(name, arm)
    print("\n## Category learner arms (confirm expected kind, reject other emitted kinds)")
    for name, arm in report["category_learner"].items():
        print_learner_arm(name, arm)
    probe = report["shift_probe"]
    if "skipped" in probe:
        print(f"\n## Synthetic shift probe skipped: {probe['skipped']}")
        return
    print(
        "\n## Synthetic shift probe (labels flipped after convergence; not dataset evidence)"
    )
    print(
        f"  agree={probe['agree_events']} flip={probe['flip_events']} "
        f"probe={probe['probe_requests']} "
        f"acc_before={probe['accuracy_before_flip']:.4f} "
        f"acc_after={probe['accuracy_after_flip']:.4f} "
        f"delta={probe['accuracy_delta']:+.4f} "
        f"detections={probe['detections_during_flip']} "
        f"warnings={probe['warnings_during_flip']}"
    )
    seed = report.get("seed")
    if seed:
        print("\n## Seed export (canonical recipe: baseline findings, interleaved)")
        print(f"  path={seed['export']['path']} "
              f"revision={seed['export']['revision']} "
              f"examples={seed['export']['examples_seen']} "
              f"counts={seed['export']['classification_counts']}")
        print(f"  probe={seed['probe_requests']} "
              f"verify_identical={seed['verification']['identical']} "
              f"matched={seed['verification']['matched']}/{seed['verification']['probe_requests']} "
              f"drift_at_export={seed['drift_at_export']}")


if __name__ == "__main__":
    main()
