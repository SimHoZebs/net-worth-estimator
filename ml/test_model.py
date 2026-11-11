import copy
import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from evidence import features_from_request
from model import ConflictError, PaymentModelStore


def request(rid="request-1", amount="52000.00"):
    return {
        "id": rid, "kind": "income", "patternId": "owner-account-pattern",
        "question": {"label": "income", "supportSignals": ["payroll-descriptor", "source-income"], "candidateSignals": [], "excludeSignals": [], "suggestWithoutSignal": True},
        "pattern": {
            "merchant": "acme", "cadence": "biweekly", "currency": "USD",
            "typicalAmount": "2000.00", "annualizedEstimate": amount,
            "occurrenceCount": 3, "cadenceDays": 14,
            "amountVariation": 0.02, "intervalVariation": 0.01,
            "recencyDays": 0, "direction":"inflow", "signals":["payroll-descriptor"],
        },
        "samples": [{"description": "ACME PAYROLL", "amount": "2000.00", "currency": "USD"}],
    }


def feedback(event="001", action="confirm", evidence=None):
    return {"eventId": event, "runId": "reviewed-run", "action": action, "request": evidence or request()}


class TestStore(unittest.TestCase):
    def setUp(self):
        os.environ.pop("ML_DRIFT_MODE", None)
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "data", "ml.sqlite3")
        self.store = PaymentModelStore(self.path)

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_every_owner_contributes_to_one_model(self):
        before = self.store.state("bob")["revision"]
        self.store.observe("alice", "", "001", [feedback()])
        self.store.observe("bob", "", "001", [feedback(action="reject")])
        self.assertEqual(self.store._state.examples_seen, 2)
        self.assertNotEqual(before, self.store.state("bob")["revision"])
        self.assertEqual(self.store.state("alice")["revision"], self.store.state("bob")["revision"])

    def test_evaluation_contract_has_no_engine_details(self):
        evidence = request()
        original = copy.deepcopy(evidence)
        decision = self.store.evaluate([evidence])[0]
        self.assertEqual(evidence, original)
        self.assertEqual(decision, {"requestId": "request-1", "status": "ready", "decision":"supported", "strength": "strong", "reason": "Assessment of income: supported."})

    def test_feature_engineering_and_cold_start_are_adapter_owned(self):
        evidence = request(amount="650000.00")
        evidence["pattern"]["typicalAmount"] = "25000.00"
        features = features_from_request(evidence)
        self.assertTrue(features)
        self.assertTrue(all(0 <= key < 8192 for key in features))
        self.assertEqual(evidence["pattern"]["typicalAmount"], "25000.00")
        evidence["pattern"]["signals"] = []
        self.assertEqual(self.store.evaluate([evidence])[0]["strength"], "moderate")

    def test_restart_before_feedback_needs_no_prediction_cache(self):
        self.store.evaluate([request()])
        revision = self.store.state("alice")["revision"]
        self.store.close()
        self.store = PaymentModelStore(self.path)
        self.assertEqual(revision, self.store.state("alice")["revision"])
        self.assertEqual(self.store.observe("alice", "", "001", [feedback()]), {"cursor": "001"})
        self.store.close()
        self.store = PaymentModelStore(self.path)
        self.assertEqual(self.store._state.examples_seen, 1)
        self.assertEqual(self.store.state("alice")["cursor"], "001")

    def test_lost_response_replay_is_durably_idempotent(self):
        self.store.observe("alice", "", "001", [feedback()])
        revision = self.store.state("alice")["revision"]
        self.store.close()
        self.store = PaymentModelStore(self.path)
        self.store.observe("alice", "", "001", [feedback()])
        self.assertEqual(self.store._state.examples_seen, 1)
        self.assertEqual(self.store.state("alice")["revision"], revision)

    def test_event_payload_cannot_change_on_retry(self):
        self.store.observe("alice", "", "001", [feedback()])
        with self.assertRaises(ConflictError):
            self.store.observe("alice", "", "001", [feedback(action="reject")])

    def test_correction_is_a_new_example_from_the_reviewed_evidence(self):
        self.store.observe("alice", "", "001", [feedback()])
        self.store.observe("alice", "001", "002", [feedback("002", "reject", request(amount="10000.00"))])
        self.assertEqual(self.store._state.examples_seen, 2)

    def test_storage_failure_rolls_back_model_events_and_checkpoint(self):
        revision = self.store.state("alice")["revision"]
        self.store._db.execute("PRAGMA query_only=ON")
        with self.assertRaises(sqlite3.OperationalError):
            self.store.observe("alice", "", "001", [feedback()])
        self.assertEqual(self.store.state("alice"), {"revision": revision, "cursor": "",
            "drift": {"mode": "auto", "pending": False, "estimation": 0.0, "width": 0, "warnings": 0, "detections": 0}})
        self.assertEqual(self.store._state.examples_seen, 0)
        self.store._db.execute("PRAGMA query_only=OFF")
        self.store.observe("alice", "", "001", [feedback()])
        self.assertEqual(self.store._state.examples_seen, 1)

    def test_nontraining_events_advance_only_the_delivery_checkpoint(self):
        revision = self.store.state("alice")["revision"]
        self.store.observe("alice", "", "005", [])
        self.assertEqual(self.store.state("alice"), {"revision": revision, "cursor": "005",
            "drift": {"mode": "auto", "pending": False, "estimation": 0.0, "width": 0, "warnings": 0, "detections": 0}})

    def test_invalid_batch_is_atomic(self):
        bad = feedback("002")
        bad["request"]["pattern"]["amountVariation"] = float("nan")
        with self.assertRaises(ValueError):
            self.store.observe("alice", "", "002", [feedback(), bad])
        self.assertEqual(self.store.state("alice")["cursor"], "")
        self.assertEqual(self.store._state.examples_seen, 0)

    def test_new_model_generation_changes_revision(self):
        fresh = PaymentModelStore(os.path.join(self.tmp.name, "new.sqlite3"))
        try:
            self.assertNotEqual(self.store.state("alice")["revision"], fresh.state("alice")["revision"])
        finally:
            fresh.close()

    def test_new_classifications_share_one_learner_without_cross_type_cold_start(self):
        rent = request("rent-request")
        rent["kind"] = "rent"
        rent["question"] = {"label": "rent", "supportSignals": ["rent-descriptor"], "candidateSignals": ["housing-platform"], "excludeSignals": ["mortgage-descriptor", "card-repayment"], "suggestWithoutSignal": False}
        rent["pattern"]["direction"] = "outflow"
        rent["pattern"]["signals"] = ["housing-platform"]
        rent["samples"] = [{"description": "BILT", "amount": "-1800.00", "currency": "USD"}]
        self.store.observe("alice", "", "002", [feedback("001"), feedback("002")])
        self.assertEqual(self.store.evaluate([rent])[0]["decision"], "uncertain")
        rent["pattern"]["signals"].append("rent-descriptor")
        self.assertEqual(self.store.evaluate([rent])[0]["decision"], "supported")
        rent["pattern"]["signals"].append("card-repayment")
        self.assertEqual(self.store.evaluate([rent])[0]["decision"], "unsupported")
        self.store.observe("bob", "", "001", [feedback(evidence=rent, action="reject")])
        self.assertEqual(self.store._state.classification_counts, {"income": 2, "rent": 1})
        self.assertEqual(self.store.state("alice")["cursor"], "002")
        self.assertEqual(self.store.state("bob")["cursor"], "001")

    def test_feature_space_is_bounded_for_hundreds_of_types(self):
        keys = set()
        for i in range(300):
            evidence = request(str(i))
            evidence["kind"] = f"type-{i}"
            keys.update(features_from_request(evidence))
        self.assertLessEqual(len(keys), 8192)

    def test_one_observation_does_not_invent_repetition_or_annual_estimate(self):
        evidence=request()
        evidence["pattern"].update({"occurrenceCount":1,"cadence":"","cadenceDays":0})
        del evidence["pattern"]["annualizedEstimate"]
        self.assertEqual(self.store.evaluate([evidence])[0]["decision"],"supported")
        evidence["question"]["requiredSignals"]=["regular-cadence"]
        self.assertEqual(self.store.evaluate([evidence])[0]["decision"],"unsupported")

    def test_drift_stats_are_visible_in_state(self):
        drift = self.store.state("alice")["drift"]
        self.assertEqual(drift, {"mode": "auto", "pending": False, "estimation": 0.0, "width": 0, "warnings": 0, "detections": 0})
        self.store.observe("alice", "", "001", [feedback()])
        drift = self.store.state("alice")["drift"]
        self.assertGreaterEqual(drift["width"], 1)
        self.assertFalse(drift["pending"])

    def test_auto_mode_resets_on_drift(self):
        revision = self.store.state("alice")["revision"]
        items = ([feedback(f"{i:03d}", "reject") for i in range(1, 101)]
                 + [feedback(f"{i:03d}", "confirm") for i in range(101, 141)])
        self.store.observe("alice", "", "140", items)
        drift = self.store.state("alice")["drift"]
        self.assertEqual(drift["mode"], "auto")
        self.assertFalse(drift["pending"])
        self.assertGreaterEqual(drift["detections"], 1)
        self.assertLess(self.store._state.examples_seen, 140)
        self.assertNotEqual(self.store.state("alice")["revision"], revision)

    def test_unknown_drift_mode_is_rejected(self):
        with mock.patch.dict(os.environ, {"ML_DRIFT_MODE": "bogus"}):
            with self.assertRaises(ValueError):
                PaymentModelStore(os.path.join(self.tmp.name, "bogus.sqlite3"))

    def _manual_store(self):
        with mock.patch.dict(os.environ, {"ML_DRIFT_MODE": "manual"}):
            return PaymentModelStore(os.path.join(self.tmp.name, "manual.sqlite3"))

    def _trip_manual_detector(self, store):
        cursor = ""
        for batch in range(5):
            items = [feedback(f"{batch * 20 + i + 1:03d}", "reject") for i in range(20)]
            nxt = f"{(batch + 1) * 20:03d}"
            store.observe("alice", cursor, nxt, items)
            cursor = nxt
        trip = None
        for probe in range(12):
            start = 101 + probe * 5
            items = [feedback(f"{i:03d}", "confirm") for i in range(start, start + 5)]
            nxt = f"{start + 4:03d}"
            pre = store.state("alice")["revision"]
            try:
                store.observe("alice", cursor, nxt, items)
            except ConflictError:
                trip = (cursor, nxt, items, pre)
                break
            cursor = nxt
        self.assertIsNotNone(trip, "crafted shift did not trip the manual detector")
        return trip

    def test_manual_mode_freezes_learning_and_flags_pending(self):
        store = self._manual_store()
        try:
            after, cursor, _, pre_trip = self._trip_manual_detector(store)
            drift = store.state("alice")["drift"]
            self.assertEqual(drift["mode"], "manual")
            self.assertTrue(drift["pending"])
            self.assertEqual(drift["detections"], 1)
            # The tripping batch rolled back: nothing learned, cursor held back.
            self.assertEqual(store.state("alice")["cursor"], after)
            self.assertEqual(store.state("alice")["revision"], pre_trip)
            self.assertEqual(store._state.examples_seen, 125)
            # Frozen weights keep serving evaluations while pending: the learned
            # model path answers uncertain, where a wiped model would fall back
            # to the cold-start baseline of supported.
            self.assertEqual(store.evaluate([request()])[0]["decision"], "uncertain")
            with self.assertRaises(ConflictError):
                store.observe("alice", after, cursor, [feedback(cursor)])
            # Empty batches still advance delivery while frozen.
            self.assertEqual(store.observe("alice", after, "126", []), {"cursor": "126"})
        finally:
            store.close()

    def test_manual_reset_wipes_and_releases_the_pending_batch(self):
        store = self._manual_store()
        try:
            after, cursor, items, _ = self._trip_manual_detector(store)
            revision = store.state("alice")["revision"]
            out = store.reset_drift()
            self.assertNotEqual(out["revision"], revision)
            self.assertEqual(out, {"revision": out["revision"], "pending": False})
            self.assertFalse(store.state("alice")["drift"]["pending"])
            self.assertEqual(store._state.examples_seen, 0)
            # Nothing from the tripping batch was recorded, so the redelivered
            # batch trains fully on the fresh weights instead of dedupe-skipping.
            self.assertEqual(store.observe("alice", after, cursor, items), {"cursor": cursor})
            self.assertEqual(store._state.examples_seen, len(items))
        finally:
            store.close()

    def test_manual_dismiss_keeps_weights_and_trains_pending_feedback(self):
        store = self._manual_store()
        try:
            after, cursor, items, _ = self._trip_manual_detector(store)
            learned = store._state.examples_seen
            self.assertGreater(learned, 0)
            revision = store.state("alice")["revision"]
            out = store.dismiss_drift()
            self.assertNotEqual(out["revision"], revision)
            self.assertEqual(out, {"revision": out["revision"], "pending": False})
            self.assertFalse(store.state("alice")["drift"]["pending"])
            self.assertEqual(store._state.examples_seen, learned)
            self.assertEqual(store.state("alice")["drift"]["width"], 0)
            # The rejected batch was never recorded, so retrying it after the
            # detector restart trains instead of being silently skipped.
            self.assertEqual(store.observe("alice", after, cursor, items), {"cursor": cursor})
            self.assertEqual(store._state.examples_seen, learned + len(items))
        finally:
            store.close()

    def test_reset_and_dismiss_without_pending_conflict(self):
        with self.assertRaises(ConflictError):
            self.store.reset_drift()
        with self.assertRaises(ConflictError):
            self.store.dismiss_drift()


if __name__ == "__main__":
    unittest.main()
