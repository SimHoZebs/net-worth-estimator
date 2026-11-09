"""One deployment-wide River learner with transactional feedback delivery.

Domain evidence comes from the immutable Go prediction, never a prediction
cache. This adapter alone engineers features. SQLite commits model state, event deduplication, and owner checkpoints
together. Only this process owns the database; run one sidecar per deployment.
"""
from __future__ import annotations

import hashlib
import json
import os
import pickle
import sqlite3
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from river import compose, linear_model, optim, preprocessing
from river.drift import ADWIN

from evidence import features_from_request


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


class ConflictError(ValueError):
    pass


class IncomeModelStore:
    def __init__(self, model_path: str | None = None):
        path = Path(model_path or os.environ.get("INCOME_MODEL_PATH", "/tmp/income.sqlite3"))
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=FULL")
        with self._db:
            self._db.execute("CREATE TABLE IF NOT EXISTS model (id INTEGER PRIMARY KEY CHECK(id=1), generation TEXT NOT NULL, revision INTEGER NOT NULL, state BLOB NOT NULL)")
            self._db.execute("CREATE TABLE IF NOT EXISTS checkpoints (owner TEXT PRIMARY KEY, cursor TEXT NOT NULL)")
            self._db.execute("CREATE TABLE IF NOT EXISTS events (owner TEXT NOT NULL, event_id TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(owner, event_id))")
            self._db.execute("INSERT OR IGNORE INTO model VALUES (1, ?, 0, ?)", (str(uuid.uuid4()), pickle.dumps(ModelState())))
        generation, revision, raw = self._db.execute("SELECT generation, revision, state FROM model WHERE id=1").fetchone()
        self._generation, self._revision = generation, revision
        # Corrupt or incompatible state is an operator-visible startup failure.
        self._state = pickle.loads(raw)

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
            return {"revision": f"{self._generation}:{self._revision}", "cursor": self._cursor(owner)}

    def evaluate(self, requests):
        if not isinstance(requests, list) or len(requests) > 10000:
            raise ValueError("requests must be a bounded list")
        features = [features_from_request(request) for request in requests]
        with self._lock:
            out = []
            for request, feats in zip(requests, features):
                if self._state.examples_seen < 2:
                    strong = bool(feats["descriptor_hit"] or feats["category_income"])
                else:
                    probability = float(self._state.model.predict_proba_one(feats).get(True, 0.5))
                    strong = probability >= 0.75
                out.append({"requestId": request["id"], "status": "ready",
                            "strength": "strong" if strong else "moderate",
                            "reason": "Evidence supports income." if strong else "Income remains uncertain."})
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
            # Work on a copy: disk failure must leave both model and checkpoint
            # unchanged in memory as well as on disk.
            candidate = pickle.loads(pickle.dumps(self._state))
            learned = 0
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
                    if candidate.drift.drift_detected:
                        candidate = ModelState()
                    candidate.model.learn_one(feats, label)
                    candidate.examples_seen += 1
                    learned += 1
                    self._db.execute("INSERT INTO events VALUES (?, ?, ?)", (owner, item["eventId"], fingerprint))
                if learned:
                    self._db.execute("UPDATE model SET revision=?, state=? WHERE id=1", (self._revision+1, pickle.dumps(candidate)))
                self._db.execute("INSERT INTO checkpoints VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET cursor=excluded.cursor", (owner, cursor))
            if learned:
                self._state = candidate
                self._revision += 1
            return {"cursor": cursor}
