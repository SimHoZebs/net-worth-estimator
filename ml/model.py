"""One deployment-wide River learner with transactional feedback delivery.

Domain evidence comes from the immutable Go prediction, never a prediction
cache. This adapter alone engineers features. SQLite commits model state, event deduplication, and owner checkpoints
together. Only this process owns the database; run one ML service per deployment.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import pickle
import sqlite3
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from river import compose, linear_model, optim, preprocessing
from river.drift import ADWIN

from evidence import FEATURE_BUCKETS, baseline_decision, features_from_request

MODEL_FORMAT_VERSION = 2
DEFAULT_THRESHOLD_HIGH = 0.75
DEFAULT_THRESHOLD_LOW = 0.25


def _thresholds_from_env():
    high_raw = os.environ.get("ML_THRESHOLD_HIGH", str(DEFAULT_THRESHOLD_HIGH))
    low_raw = os.environ.get("ML_THRESHOLD_LOW", str(DEFAULT_THRESHOLD_LOW))
    try:
        high = float(high_raw)
        low = float(low_raw)
    except ValueError:
        raise ValueError("ML_THRESHOLD_HIGH and ML_THRESHOLD_LOW must be numbers satisfying 0 < low < high < 1")
    if not math.isfinite(high) or not math.isfinite(low) or not (0 < low < high < 1):
        raise ValueError(f"ML_THRESHOLD_LOW ({low_raw}) and ML_THRESHOLD_HIGH ({high_raw}) must satisfy 0 < low < high < 1")
    return low, high


def _new_model():
    return compose.Pipeline(
        preprocessing.StandardScaler(),
        linear_model.LogisticRegression(optimizer=optim.SGD(0.1)),
    )


@dataclass
class ModelState:
    model: object = field(default_factory=_new_model)
    drift: object = field(default_factory=lambda: ADWIN(delta=0.002))
    examples_seen: int = 0
    classification_counts: dict = field(default_factory=dict)
    buckets: int = FEATURE_BUCKETS
    format_version: int = MODEL_FORMAT_VERSION


class ConflictError(ValueError):
    pass


class _DriftTripped(Exception):
    """Control flow for a manual-mode drift trip; never escapes observe."""


class PaymentModelStore:
    def __init__(self, model_path: str | None = None):
        self._threshold_low, self._threshold_high = _thresholds_from_env()
        raw = model_path or os.environ.get("ML_MODEL_PATH", "")
        if not raw or not raw.strip():
            raise ValueError("ML_MODEL_PATH or model_path must name persistent storage; refusing to start without explicit persistent storage (set ML_MODEL_PATH)")
        path = Path(raw.strip())
        path.parent.mkdir(parents=True, exist_ok=True)
        mode = (os.environ.get("ML_DRIFT_MODE") or "auto").strip()
        if mode not in ("auto", "manual"):
            raise ValueError("ML_DRIFT_MODE must be auto or manual")
        self._drift_mode = mode
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=FULL")
        with self._db:
            self._db.execute("CREATE TABLE IF NOT EXISTS model (id INTEGER PRIMARY KEY CHECK(id=1), generation TEXT NOT NULL, revision INTEGER NOT NULL, state BLOB NOT NULL)")
            self._db.execute("CREATE TABLE IF NOT EXISTS checkpoints (owner TEXT PRIMARY KEY, cursor TEXT NOT NULL)")
            self._db.execute("CREATE TABLE IF NOT EXISTS events (owner TEXT NOT NULL, event_id TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(owner, event_id))")
            self._db.execute("CREATE TABLE IF NOT EXISTS drift (id INTEGER PRIMARY KEY CHECK(id=1), pending INTEGER NOT NULL, warnings INTEGER NOT NULL, detections INTEGER NOT NULL)")
            self._db.execute("INSERT OR IGNORE INTO model VALUES (1, ?, 0, ?)", (str(uuid.uuid4()), pickle.dumps(ModelState())))
            self._db.execute("INSERT OR IGNORE INTO drift VALUES (1, 0, 0, 0)")
        generation, revision, raw = self._db.execute("SELECT generation, revision, state FROM model WHERE id=1").fetchone()
        self._generation, self._revision = generation, revision
        # Corrupt or incompatible state is an operator-visible startup failure.
        self._state = pickle.loads(raw)
        if not isinstance(self._state, ModelState) or "classification_counts" not in vars(self._state):
            raise ValueError("incompatible learner state; configure a fresh ML_MODEL_PATH database before startup and archive the old DB")
        state_vars = vars(self._state)
        if state_vars.get("buckets") != FEATURE_BUCKETS or state_vars.get("format_version") != MODEL_FORMAT_VERSION:
            raise ValueError(
                f"incompatible learner state (expected buckets={FEATURE_BUCKETS} format=v{MODEL_FORMAT_VERSION}); "
                "configure a fresh ML_MODEL_PATH database before startup and archive the old DB; "
                "no runtime migration or silent reset is performed"
            )

    def _revision_string(self):
        return f"payments-v2:b{FEATURE_BUCKETS}:h{self._threshold_high}:l{self._threshold_low}:{self._generation}:{self._revision}"

    def close(self):
        with self._lock:
            self._db.close()

    def health(self):
        with self._lock:
            self._db.execute("SELECT revision FROM model WHERE id=1").fetchone()

    def _cursor(self, owner):
        row = self._db.execute("SELECT cursor FROM checkpoints WHERE owner=?", (owner,)).fetchone()
        return row[0] if row else ""

    def state(self, owner):
        if not isinstance(owner, str) or not owner or len(owner) > 512:
            raise ValueError("owner is required")
        with self._lock:
            pending, warnings, detections = self._db.execute("SELECT pending, warnings, detections FROM drift WHERE id=1").fetchone()
            return {"revision": self._revision_string(), "cursor": self._cursor(owner),
                    "drift": {"mode": self._drift_mode, "pending": bool(pending),
                              "estimation": float(self._state.drift.estimation), "width": int(self._state.drift.width),
                              "warnings": warnings, "detections": detections}}

    def evaluate(self, requests):
        if not isinstance(requests, list) or len(requests) > 10000:
            raise ValueError("requests must be a bounded list")
        features = [features_from_request(request) for request in requests]
        with self._lock:
            out = []
            for request, feats in zip(requests, features):
                if self._state.classification_counts.get(request["kind"], 0) < 2:
                    decision = baseline_decision(request)
                    strong = decision != "uncertain"
                else:
                    probability = float(self._state.model.predict_proba_one(feats).get(True, 0.5))
                    decision = "supported" if probability >= self._threshold_high else "unsupported" if probability <= self._threshold_low else "uncertain"
                    strong = decision != "uncertain"
                out.append({"requestId": request["id"], "status": "ready",
                            "decision": decision,
                            "strength": "strong" if strong else "moderate",
                            "reason": f"Assessment of {request['question']['label']}: {decision}."})
            return out

    def observe(self, owner, after, cursor, feedback):
        if not isinstance(owner, str) or not owner or len(owner) > 512:
            raise ValueError("owner is required")
        if not isinstance(after, str) or not isinstance(cursor, str) or not cursor or cursor <= after:
            raise ValueError("cursor must advance after")
        if not isinstance(feedback, list) or len(feedback) > 200:
            raise ValueError("feedback must be a bounded list")
        for item in feedback:
            if not isinstance(item, dict) or item.get("action") not in ("confirm", "reject"):
                raise ValueError("action must be confirm or reject")
            if not isinstance(item.get("eventId"), str) or not after < item["eventId"] <= cursor:
                raise ValueError("event must belong to checkpoint interval")
            if not isinstance(item.get("runId"), str) or not item["runId"]:
                raise ValueError("runId is required")
            features_from_request(item.get("request"))
        with self._lock:
            checkpoint = self._cursor(owner)
            if checkpoint not in (after, cursor):
                raise ConflictError("feedback checkpoint changed; reload state")
            pending, _, _ = self._db.execute("SELECT pending, warnings, detections FROM drift WHERE id=1").fetchone()
            if pending and feedback:
                raise ConflictError("drift review pending; resolve via /drift/reset or /drift/dismiss")
            # Work on a copy: disk failure must leave both model and checkpoint
            # unchanged in memory as well as on disk.
            candidate = pickle.loads(pickle.dumps(self._state))
            learned = 0
            warned = 0
            detected = 0
            tripped = False
            try:
                with self._db:
                    for item in feedback:
                        fingerprint = hashlib.sha256(json.dumps(item, sort_keys=True, allow_nan=False).encode()).hexdigest()
                        prior = self._db.execute("SELECT fingerprint FROM events WHERE owner=? AND event_id=?", (owner, item["eventId"])).fetchone()
                        if prior:
                            if prior[0] != fingerprint:
                                raise ConflictError("feedback event payload changed")
                            continue
                        if checkpoint == cursor:
                            raise ConflictError("replayed batch contains a new event")
                        feats, label = features_from_request(item["request"]), item["action"] == "confirm"
                        pred = candidate.model.predict_one(feats)
                        candidate.drift.update(int(bool(pred) != label))
                        if getattr(candidate.drift, "warning_detected", False):
                            warned += 1
                            logging.warning("ml drift warning for owner %s", owner)
                        if candidate.drift.drift_detected:
                            detected += 1
                            if self._drift_mode == "manual":
                                tripped = True
                                raise _DriftTripped
                            logging.error("ml drift detected for owner %s; reset learner", owner)
                            candidate = ModelState()
                        candidate.model.learn_one(feats, label)
                        candidate.examples_seen += 1
                        kind = item["request"]["kind"]
                        candidate.classification_counts[kind] = candidate.classification_counts.get(kind, 0) + 1
                        learned += 1
                        self._db.execute("INSERT INTO events VALUES (?, ?, ?)", (owner, item["eventId"], fingerprint))
                    if warned or detected:
                        self._db.execute("UPDATE drift SET warnings=warnings+?, detections=detections+? WHERE id=1", (warned, detected))
                    if learned:
                        self._db.execute("UPDATE model SET revision=?, state=? WHERE id=1", (self._revision+1, pickle.dumps(candidate)))
                    self._db.execute("INSERT INTO checkpoints VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET cursor=excluded.cursor", (owner, cursor))
            except _DriftTripped:
                pass
            if tripped:
                # The tripping batch raised before commit, so none of its events
                # were recorded and the delivery cursor did not advance. The Go
                # adapter treats the 409 as a retryable failure, so the same
                # batch is redelivered after reset or dismiss and trains fully.
                logging.error("ml drift detected for owner %s; learning frozen pending operator review", owner)
                with self._db:
                    self._db.execute("UPDATE drift SET pending=1, warnings=warnings+?, detections=detections+? WHERE id=1", (warned, detected))
                raise ConflictError("drift detected; learning frozen pending review via /drift/reset or /drift/dismiss")
            if learned:
                self._state = candidate
                self._revision += 1
            return {"cursor": cursor}

    def reset_drift(self):
        with self._lock:
            pending = self._db.execute("SELECT pending FROM drift WHERE id=1").fetchone()[0]
            if not pending:
                raise ConflictError("no drift review pending")
            with self._db:
                self._db.execute("UPDATE model SET revision=?, state=? WHERE id=1", (self._revision+1, pickle.dumps(ModelState())))
                self._db.execute("UPDATE drift SET pending=0 WHERE id=1")
            self._state = ModelState()
            self._revision += 1
            return {"revision": self._revision_string(), "pending": False}

    def dismiss_drift(self):
        with self._lock:
            pending = self._db.execute("SELECT pending FROM drift WHERE id=1").fetchone()[0]
            if not pending:
                raise ConflictError("no drift review pending")
            candidate = pickle.loads(pickle.dumps(self._state))
            candidate.drift = ADWIN(delta=candidate.drift.delta)
            with self._db:
                self._db.execute("UPDATE model SET revision=?, state=? WHERE id=1", (self._revision+1, pickle.dumps(candidate)))
                self._db.execute("UPDATE drift SET pending=0 WHERE id=1")
            self._state = candidate
            self._revision += 1
            return {"revision": self._revision_string(), "pending": False}
