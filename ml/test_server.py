import io
import json
import os
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock
from unittest.mock import Mock

from model import PaymentModelStore
from server import Handler
from test_model import request, feedback


class TestServer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = PaymentModelStore(self.tmp.name + "/ml.sqlite3")

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def request(self, path, payload):
        handler = Handler.__new__(Handler)
        handler.server = SimpleNamespace(model_store=self.store)
        handler.path = path
        body = json.dumps(payload).encode()
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body)
        handler._json = Mock()
        handler.do_POST()
        return handler._json.call_args.args

    def test_neutral_state_evaluate_feedback_contract(self):
        self.assertEqual(self.request("/state", {"owner": "alice"})[0], 200)
        code, out = self.request("/evaluate", {"requests": [request()]})
        self.assertEqual(code, 200)
        self.assertEqual(out["judgments"][0]["status"], "ready")
        code, out = self.request("/feedback", {"owner": "alice", "after": "", "cursor": "001", "feedback": [feedback()]})
        self.assertEqual(code, 200)
        self.assertEqual(out, {"cursor": "001"})

    def test_malformed_requests_are_rejected(self):
        for path, payload in [("/evaluate", []), ("/evaluate", {"requests": [None]}),
                              ("/state", {}), ("/feedback", {}),
                              ("/drift/reset", []), ("/drift/dismiss", [])]:
            with self.subTest(path=path, payload=payload):
                self.assertEqual(self.request(path, payload)[0], 400)

    def test_storage_failure_is_visible(self):
        self.store._db.execute("PRAGMA query_only=ON")
        with self.assertLogs(level="ERROR"):
            code, _ = self.request("/feedback", {"owner": "alice", "after": "", "cursor": "001", "feedback": [feedback()]})
        self.assertEqual(code, 503)

    def test_state_reports_drift_stats(self):
        code, out = self.request("/state", {"owner": "alice"})
        self.assertEqual(code, 200)
        self.assertEqual(out["drift"], {"mode": "auto", "pending": False, "estimation": 0.0,
                                        "width": 0, "warnings": 0, "detections": 0})

    def test_drift_reset_and_dismiss_without_pending_conflict(self):
        for path in ("/drift/reset", "/drift/dismiss"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path, {})[0], 409)

    def test_manual_drift_freeze_and_operator_recovery(self):
        self.store.close()
        with mock.patch.dict(os.environ, {"ML_DRIFT_MODE": "manual"}):
            self.store = PaymentModelStore(self.tmp.name + "/ml.sqlite3")
        shift = ([feedback(f"{i:03d}", "reject") for i in range(1, 101)]
                 + [feedback(f"{i:03d}", "confirm") for i in range(101, 141)])
        code, out = self.request("/feedback", {"owner": "alice", "after": "", "cursor": "140", "feedback": shift})
        self.assertEqual(code, 409)
        self.assertIn("drift", out["error"])
        code, out = self.request("/state", {"owner": "alice"})
        self.assertEqual(code, 200)
        self.assertTrue(out["drift"]["pending"])
        self.assertEqual(out["drift"]["mode"], "manual")
        code, out = self.request("/evaluate", {"requests": [request()]})
        self.assertEqual(code, 200)
        self.assertEqual(out["judgments"][0]["status"], "ready")
        revision = self.request("/state", {"owner": "alice"})[1]["revision"]
        code, out = self.request("/drift/dismiss", {})
        self.assertEqual(code, 200)
        self.assertEqual(out, {"revision": out["revision"], "pending": False})
        self.assertNotEqual(out["revision"], revision)
        code, out = self.request("/feedback", {"owner": "alice", "after": "", "cursor": "003",
                                               "feedback": [feedback("001"), feedback("002"), feedback("003")]})
        self.assertEqual(code, 200)
        self.assertEqual(out, {"cursor": "003"})


if __name__ == "__main__":
    unittest.main()
