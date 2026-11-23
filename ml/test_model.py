import copy
import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from evidence import FEATURE_BUCKETS, features_from_request
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


CATEGORY_KEYS = (
    "INCOME", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "BANK_FEES",
    "ENTERTAINMENT", "FOOD_AND_DRINK", "GENERAL_MERCHANDISE", "HOME_IMPROVEMENT",
    "MEDICAL", "PERSONAL_CARE", "GENERAL_SERVICES", "GOVERNMENT_AND_NON_PROFIT",
    "TRANSPORTATION", "TRAVEL", "RENT_AND_UTILITIES",
)


def category_request(rid="category-1", kind="category:FOOD_AND_DRINK", signals=("dining-descriptor",)):
    signals = list(signals)
    return {
        "id": rid, "kind": kind, "patternId": f"txn-content-hash-{rid}",
        "question": {"label": kind.split(":", 1)[1].lower().replace("_", " "),
                     "supportSignals": ["dining-descriptor"], "candidateSignals": ["dining-candidate"],
                     "excludeSignals": ["card-repayment"], "suggestWithoutSignal": False},
        "pattern": {
            "merchant": f"merchant-{rid}", "cadence": "", "currency": "USD",
            "typicalAmount": "42.50",
            "occurrenceCount": 1, "cadenceDays": 0,
            "amountVariation": 0, "intervalVariation": 0,
            "recencyDays": 0, "direction": "outflow", "signals": signals,
        },
        "samples": [{"description": "BISTRO 123", "amount": "-42.50", "currency": "USD"}],
    }


class TestStore(unittest.TestCase):
    def setUp(self):
        os.environ.pop("ML_THRESHOLD_HIGH", None)
        os.environ.pop("ML_THRESHOLD_LOW", None)
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "data", "ml.sqlite3")
        self.store = PaymentModelStore(self.path)

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()
        os.environ.pop("ML_THRESHOLD_HIGH", None)
        os.environ.pop("ML_THRESHOLD_LOW", None)

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
        self.assertEqual(decision, {"requestId": "request-1", "status": "ready", "decision":"supported", "strength": "strong"})

    def test_feature_engineering_and_cold_start_are_adapter_owned(self):
        evidence = request(amount="650000.00")
        evidence["pattern"]["typicalAmount"] = "25000.00"
        features = features_from_request(evidence)
        self.assertTrue(features)
        self.assertTrue(all(0 <= key < FEATURE_BUCKETS for key in features))
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

    def test_lost_response_retry_is_durably_idempotent(self):
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
        self.assertEqual(self.store.state("alice"), {"revision": revision, "cursor": ""})
        self.assertEqual(self.store._state.examples_seen, 0)
        self.store._db.execute("PRAGMA query_only=OFF")
        self.store.observe("alice", "", "001", [feedback()])
        self.assertEqual(self.store._state.examples_seen, 1)

    def test_nontraining_events_advance_only_the_delivery_checkpoint(self):
        revision = self.store.state("alice")["revision"]
        self.store.observe("alice", "", "005", [])
        self.assertEqual(self.store.state("alice"), {"revision": revision, "cursor": "005"})

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
        self.assertLessEqual(len(keys), FEATURE_BUCKETS)

    def test_one_observation_does_not_invent_repetition_or_annual_estimate(self):
        evidence=request()
        evidence["pattern"].update({"occurrenceCount":1,"cadence":"","cadenceDays":0})
        del evidence["pattern"]["annualizedEstimate"]
        self.assertEqual(self.store.evaluate([evidence])[0]["decision"],"supported")
        evidence["question"]["requiredSignals"]=["regular-cadence"]
        self.assertEqual(self.store.evaluate([evidence])[0]["decision"],"unsupported")

    def test_category_cold_start_follows_observed_signals(self):
        supported = category_request(signals=["dining-descriptor"])
        self.assertNotIn("annualizedEstimate", supported["pattern"])
        self.assertTrue(all(0 <= key < FEATURE_BUCKETS for key in features_from_request(supported)))
        judged = self.store.evaluate([supported])[0]
        self.assertEqual((judged["decision"], judged["strength"]), ("supported", "strong"))
        unsupported = category_request("category-2", signals=[])
        judged = self.store.evaluate([unsupported])[0]
        self.assertEqual((judged["decision"], judged["strength"]), ("unsupported", "strong"))
        candidate = category_request("category-3", signals=["dining-candidate"])
        judged = self.store.evaluate([candidate])[0]
        self.assertEqual((judged["decision"], judged["strength"]), ("uncertain", "moderate"))

    def test_category_training_counts_stay_per_kind(self):
        first = category_request("category-1", signals=["dining-descriptor"])
        second = category_request("category-2", signals=["dining-descriptor"])
        self.store.observe("alice", "", "002", [
            {"eventId": "001", "runId": "reviewed-run", "action": "confirm", "request": first},
            {"eventId": "002", "runId": "reviewed-run", "action": "reject", "request": second},
        ])
        self.assertEqual(self.store._state.classification_counts, {"category:FOOD_AND_DRINK": 2})
        travel = category_request("category-3", kind="category:TRAVEL", signals=[])
        with mock.patch.object(self.store._state.model, "predict_proba_one", return_value={True: 0.99}):
            self.assertEqual(self.store.evaluate([travel])[0]["decision"], "unsupported")

    def test_feature_space_is_bounded_for_payments_and_categories(self):
        kinds = ["income", "rent", "utility", "auto-insurance", "card-payment"]
        kinds += [f"category:{key}" for key in CATEGORY_KEYS]
        self.assertEqual(len(kinds), 21)
        keys = set()
        for i, kind in enumerate(kinds):
            if kind.startswith("category:"):
                evidence = category_request(f"bounded-{i}", kind=kind)
            else:
                evidence = request(f"bounded-{i}")
                evidence["kind"] = kind
            evidence["pattern"]["merchant"] = f"bounded-merchant-{i}"
            keys.update(features_from_request(evidence))
        self.assertLessEqual(len(keys), FEATURE_BUCKETS)

    def test_revision_uses_payments_v2_with_buckets_and_thresholds(self):
        revision = self.store.state("alice")["revision"]
        self.assertTrue(revision.startswith("payments-v2:"))
        self.assertIn(f"b{FEATURE_BUCKETS}", revision)
        self.assertIn("h0.75", revision)
        self.assertIn("l0.25", revision)

    def test_custom_thresholds_change_revision_and_boundary_decisions(self):
        self.store.observe("alice", "", "002", [feedback("001"), feedback("002")])
        with mock.patch.object(self.store._state.model, "predict_proba_one", return_value={True: 0.8}):
            self.assertEqual(self.store.evaluate([request()])[0]["decision"], "supported")
        default_revision = self.store.state("alice")["revision"]
        with mock.patch.dict(os.environ, {"ML_THRESHOLD_HIGH": "0.9", "ML_THRESHOLD_LOW": "0.1"}):
            custom_path = os.path.join(self.tmp.name, "custom.sqlite3")
            custom = PaymentModelStore(custom_path)
            try:
                custom.observe("alice", "", "002", [feedback("001"), feedback("002")])
                with mock.patch.object(custom._state.model, "predict_proba_one", return_value={True: 0.8}):
                    self.assertEqual(custom.evaluate([request()])[0]["decision"], "uncertain")
                with mock.patch.object(custom._state.model, "predict_proba_one", return_value={True: 0.2}):
                    self.assertEqual(custom.evaluate([request()])[0]["decision"], "uncertain")
                with mock.patch.object(custom._state.model, "predict_proba_one", return_value={True: 0.05}):
                    self.assertEqual(custom.evaluate([request()])[0]["decision"], "unsupported")
                custom_revision = custom.state("alice")["revision"]
                self.assertNotEqual(default_revision, custom_revision)
                self.assertIn("h0.9", custom_revision)
                self.assertIn("l0.1", custom_revision)
            finally:
                custom.close()

    def test_invalid_thresholds_raise(self):
        cases = [("0.2", "0.8"), ("1.5", "0.25"), ("0.75", "-0.1"), ("0.5", "0.5"), ("abc", "0.25"), ("0.75", "nan")]
        for index, (high, low) in enumerate(cases):
            with self.subTest(high=high, low=low):
                with mock.patch.dict(os.environ, {"ML_THRESHOLD_HIGH": high, "ML_THRESHOLD_LOW": low}):
                    with self.assertRaises(ValueError):
                        PaymentModelStore(os.path.join(self.tmp.name, f"bad-{index}.sqlite3"))

    def test_legacy_state_without_bucket_keys_raises(self):
        import pickle

        from model import ModelState
        path = os.path.join(self.tmp.name, "legacy.sqlite3")
        seed = PaymentModelStore(path)
        seed.close()
        legacy = ModelState()
        del legacy.__dict__["buckets"]
        del legacy.__dict__["format_version"]
        db = sqlite3.connect(path)
        try:
            with db:
                db.execute("UPDATE model SET state=? WHERE id=1", (pickle.dumps(legacy),))
        finally:
            db.close()
        with self.assertRaises(ValueError) as ctx:
            PaymentModelStore(path)
        self.assertIn("ML_MODEL_PATH", str(ctx.exception))

    def test_old_state_with_wrong_bucket_count_raises(self):
        import pickle

        from model import ModelState
        path = os.path.join(self.tmp.name, "old.sqlite3")
        seed = PaymentModelStore(path)
        seed.close()
        old_state = ModelState(buckets=8192, format_version=1)
        db = sqlite3.connect(path)
        try:
            with db:
                db.execute("UPDATE model SET state=? WHERE id=1", (pickle.dumps(old_state),))
        finally:
            db.close()
        with self.assertRaises(ValueError) as ctx:
            PaymentModelStore(path)
        self.assertIn("ML_MODEL_PATH", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
