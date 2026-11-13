"""River learner runs, ordering, experiment arms, drift probes, and the seed recipe for the training harness."""

from __future__ import annotations

import json
import os
import resource
import shutil
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
ML_DIR = EVAL_DIR.parent
sys.path.insert(0, str(EVAL_DIR))
sys.path.insert(0, str(ML_DIR))

from datasets import CATEGORY_KINDS, MAPPED_KINDS
from scoring import decision_accuracy


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
