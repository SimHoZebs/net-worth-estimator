#!/usr/bin/env python3
"""Private-network HTTP adapter for the deployment-wide income learner."""
from __future__ import annotations

import argparse
import json
import logging
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from model import ConflictError, IncomeModelStore

MAX_BODY = 4 * 1024 * 1024


class Server(ThreadingHTTPServer):
    def __init__(self, address, store):
        self.model_store = store
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = "income-sidecar/1"

    def _json(self, code, payload):
        body = json.dumps(payload, allow_nan=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            self._json(404, {"error": "not found"})
            return
        try:
            self.server.model_store.health()
            self._json(200, {"ok": True})
        except sqlite3.Error:
            logging.exception("income storage health failed")
            self._json(503, {"error": "storage unavailable"})

    def do_POST(self):
        if self.path not in ("/state", "/evaluate", "/feedback"):
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                self._json(413, {"error": "body must contain 1 to 4194304 bytes"})
                return
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("body must be an object")
            store = self.server.model_store
            if self.path == "/state":
                out = store.state(payload.get("owner"))
            elif self.path == "/evaluate":
                out = {"judgments": store.evaluate(payload.get("requests"))}
            else:
                out = store.observe(payload.get("owner"), payload.get("after"),
                                    payload.get("cursor"), payload.get("feedback"))
            self._json(200, out)
        except ConflictError as exc:
            self._json(409, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            self._json(400, {"error": str(exc)})
        except Exception:
            logging.exception("income sidecar request failed")
            self._json(503, {"error": "scoring or storage unavailable"})


def main():
    parser = argparse.ArgumentParser(description="income river sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    store = IncomeModelStore()
    with Server((args.host, args.port), store) as server:
        try:
            server.serve_forever()
        finally:
            store.close()


if __name__ == "__main__":
    main()
