"""Deterministic scoring, signal-support splits, and accuracy helpers for the training harness."""

from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(EVAL_DIR))

from datasets import (
    CATEGORY_KINDS,
    MAPPED_KINDS,
    MITUL_LABELS,
    resolve_expected_category,
    resolve_expected_mitul,
)


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
