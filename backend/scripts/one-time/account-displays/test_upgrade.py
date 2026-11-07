import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("upgrade", Path(__file__).with_name("upgrade.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class UpgradeTest(unittest.TestCase):
    def test_schema_and_link_preserve_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            db, backup = Path(directory) / "db", Path(directory) / "backup"
            with sqlite3.connect(db) as c:
                c.executescript("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'); CREATE TABLE accounts(user_id TEXT, id TEXT, kind TEXT, enabled INT, max_balance REAL, PRIMARY KEY(user_id,id)); INSERT INTO accounts VALUES ('owner','p','debt',1,0),('owner','i','debt',1,0),('owner','cash','cash',1,NULL); CREATE TABLE recurrence_rules(user_id TEXT, id TEXT, source_account_id TEXT, destinations TEXT, amount_resolution_json TEXT, end_date TEXT, annual_cap REAL, enabled INT);")
                charge = dict(resolver="expression", config=dict(expression="abs(p) * rate"), inputs=dict(p=dict(source="provider", provider="model-value", arguments=dict(id="p")), rate=dict(source="provider", provider="occurrence-rate", arguments=dict(annualRate=0.0399, volatility=0))))
                pay = dict(resolver="expression", config=dict(expression="91.08"), inputs={})
                c.executemany("INSERT INTO recurrence_rules VALUES ('owner',?,?,?,?,NULL,NULL,1)", [("charge", "i", "null", json.dumps(charge)), ("pay", "cash", '["i","p"]', json.dumps(pay))])
            link = dict(userId="owner", principalId="p", interestId="i", interestScheduleId="charge", paymentScheduleId="pay", name="Loan")
            module.upgrade(db, backup, link)
            with sqlite3.connect(db) as c, sqlite3.connect(backup) as b:
                for table in ("accounts", "recurrence_rules", "users"):
                    self.assertEqual(c.execute(f"SELECT * FROM {table}").fetchall(), b.execute(f"SELECT * FROM {table}").fetchall())
                display = json.loads(c.execute("SELECT display_json FROM account_displays").fetchone()[0])
                self.assertEqual(display["components"][1], dict(accountId="i", role="interest"))
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(ValueError):
                module.upgrade(db, Path(directory) / "again", link)

    def test_calculated_payment_and_custom_interest_are_not_linkable(self):
        charge = dict(resolver="expression", config=dict(expression="abs(p) * rate"), inputs=dict(p=dict(source="provider", provider="model-value", arguments=dict(id="p")), rate=dict(source="provider", provider="occurrence-rate", arguments=dict(annualRate=0.0399, volatility=0))))
        pay = dict(resolver="expression", config=dict(expression="91.08"), inputs={})
        def row(amount):
            return ("i", "null", json.dumps(amount), None, None, 1)
        self.assertTrue(module.supported_rules("p", row(charge), row(pay)))

        for literal in ("+91.08", "91.081"):
            pay["config"]["expression"] = literal
            self.assertFalse(module.supported_rules("p", row(charge), row(pay)))
        pay["config"]["expression"] = "abs(p) * .01"
        self.assertFalse(module.supported_rules("p", row(charge), row(pay)))
        pay["config"]["expression"] = "91.08"
        charge["config"]["expression"] = "abs(p) * rate + 5"
        self.assertFalse(module.supported_rules("p", row(charge), row(pay)))

    def test_unsupported_funding_rolls_back_link_and_schema(self):
        for source in (None, "missing", "other-debt", "p", "i"):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as directory:
                db, backup = Path(directory) / "db", Path(directory) / "backup"
                with sqlite3.connect(db) as c:
                    c.executescript("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'); CREATE TABLE accounts(user_id TEXT, id TEXT, kind TEXT, enabled INT, max_balance REAL, PRIMARY KEY(user_id,id)); INSERT INTO accounts VALUES ('owner','p','debt',1,0),('owner','i','debt',1,0),('owner','other-debt','debt',1,0); CREATE TABLE recurrence_rules(user_id TEXT, id TEXT, source_account_id TEXT, destinations TEXT, amount_resolution_json TEXT, end_date TEXT, annual_cap REAL, enabled INT);")
                    charge = dict(resolver="expression", config=dict(expression="abs(p) * rate"), inputs=dict(p=dict(source="provider", provider="model-value", arguments=dict(id="p")), rate=dict(source="provider", provider="occurrence-rate", arguments=dict(annualRate=0.0399, volatility=0))))
                    pay = dict(resolver="expression", config=dict(expression="91.08"), inputs={})
                    c.executemany("INSERT INTO recurrence_rules VALUES ('owner',?,?,?,?,NULL,NULL,1)", [("charge", "i", "null", json.dumps(charge)), ("pay", source, '["i","p"]', json.dumps(pay))])
                link = dict(userId="owner", principalId="p", interestId="i", interestScheduleId="charge", paymentScheduleId="pay", name="Loan")
                with self.assertRaisesRegex(ValueError, "non-debt payment funding account"):
                    module.upgrade(db, backup, link)
                with sqlite3.connect(db) as c, sqlite3.connect(backup) as b:
                    self.assertEqual(c.execute("SELECT name FROM sqlite_master WHERE name='account_displays'").fetchall(), [])
                    for table in ("accounts", "recurrence_rules", "users"):
                        self.assertEqual(c.execute(f"SELECT * FROM {table}").fetchall(), b.execute(f"SELECT * FROM {table}").fetchall())

    def test_invalid_link_rolls_back_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "db"
            with sqlite3.connect(db) as c:
                c.executescript("CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE accounts(user_id TEXT, id TEXT, kind TEXT, enabled INT, max_balance REAL, PRIMARY KEY(user_id,id));")
            with self.assertRaises(ValueError):
                module.upgrade(db, Path(directory) / "backup", dict(userId="missing", principalId="p", interestId="i", interestScheduleId="c", paymentScheduleId="m", name="Loan"))
            with sqlite3.connect(db) as c:
                self.assertEqual(c.execute("SELECT name FROM sqlite_master WHERE name='account_displays'").fetchall(), [])


if __name__ == "__main__":
    unittest.main()
