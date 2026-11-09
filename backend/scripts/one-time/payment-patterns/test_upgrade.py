import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from upgrade import upgrade


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "app.db"
        self.backup = Path(self.tmp.name) / "backup.db"
        with sqlite3.connect(self.path) as db:
            db.executescript("""
                CREATE TABLE financial (id TEXT PRIMARY KEY, data TEXT);
                INSERT INTO financial VALUES ('money','untouched');
                CREATE TABLE analysis_runs (id TEXT, type TEXT, state TEXT, version TEXT);
                INSERT INTO analysis_runs VALUES ('run','income','succeeded','income-v2');
                CREATE TABLE analysis_findings (user_id TEXT,id TEXT,analysis_type TEXT,detection_json TEXT,review_json TEXT,dismissed INTEGER,feedback_revision INTEGER);
                CREATE TABLE analysis_feedback (id TEXT,payload_json TEXT);
                INSERT INTO analysis_feedback VALUES ('event','immutable reviewed evidence');
            """)
            for owner in ("alice", "bob"):
                db.execute("INSERT INTO analysis_findings VALUES (?,?, 'income',?, ?,1,3)", (owner,"finding",json.dumps({"kind":"income","income":{"patternId":"old-pattern"},"judgmentInput":{"old":"request"},"judgment":{"old":"result"}}),'{"decision":"confirmed"}'))

    def tearDown(self):
        self.tmp.cleanup()

    def rows(self, path, table):
        with sqlite3.connect(path) as db:
            return db.execute(f"SELECT * FROM {table}").fetchall()

    def test_preserves_answers_ids_audit_financial_rows_and_private_backup(self):
        before_findings = self.rows(self.path,"analysis_findings")
        upgrade(self.path,self.backup)
        self.assertEqual(os.stat(self.backup).st_mode & 0o777,0o600)
        for table in ("financial","analysis_feedback"):
            self.assertEqual(self.rows(self.path,table),self.rows(self.backup,table))
        self.assertEqual(self.rows(self.backup,"analysis_findings"),before_findings)
        for before, after in zip(before_findings,self.rows(self.path,"analysis_findings")):
            self.assertEqual(before[:2],after[:2])
            self.assertEqual(before[4:],after[4:])
            self.assertEqual(after[2],"payments")
            self.assertEqual(json.loads(after[3]),{"kind":"income","pattern":{"patternId":"old-pattern"}})
        self.assertEqual(self.rows(self.path,"analysis_runs"),[("run","payments","succeeded","income-v2")])

    def test_bad_shape_rolls_back_all_owners(self):
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE analysis_findings SET detection_json='{}' WHERE user_id='bob'")
        before=self.rows(self.path,"analysis_findings")
        with self.assertRaises(ValueError):
            upgrade(self.path,self.backup)
        self.assertEqual(self.rows(self.path,"analysis_findings"),before)
        self.assertEqual(self.rows(self.path,"analysis_runs"),self.rows(self.backup,"analysis_runs"))

    def test_backup_cannot_be_overwritten(self):
        self.backup.write_bytes(b"existing")
        with self.assertRaises(FileExistsError):
            upgrade(self.path,self.backup)
        self.assertEqual(self.backup.read_bytes(),b"existing")


if __name__ == "__main__":
    unittest.main()
