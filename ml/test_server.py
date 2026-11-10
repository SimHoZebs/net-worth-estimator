import io
import json
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
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
                              ("/state", {}), ("/feedback", {})]:
            with self.subTest(path=path, payload=payload):
                self.assertEqual(self.request(path, payload)[0], 400)

    def test_storage_failure_is_visible(self):
        self.store._db.execute("PRAGMA query_only=ON")
        with self.assertLogs(level="ERROR"):
            code, _ = self.request("/feedback", {"owner": "alice", "after": "", "cursor": "001", "feedback": [feedback()]})
        self.assertEqual(code, 503)


if __name__ == "__main__":
    unittest.main()
