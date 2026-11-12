import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("upgrade", Path(__file__).with_name("upgrade.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def setup(db_path):
    with sqlite3.connect(db_path) as c:
        c.executescript(
            "CREATE TABLE users(id TEXT PRIMARY KEY);"
            "INSERT INTO users VALUES ('owner'),('other');"
            "CREATE TABLE accounts(user_id TEXT, id TEXT, name TEXT, kind TEXT, enabled INT, max_balance REAL, PRIMARY KEY(user_id,id));"
            "INSERT INTO accounts VALUES"
            " ('owner','p','Loan Principal','debt',1,0),"
            " ('owner','i','Loan Interest','debt',1,0),"
            " ('owner','cash','Cash','cash',1,NULL),"
            " ('other','solo','Solo','cash',1,NULL);"
            "CREATE TABLE recurrence_rules(user_id TEXT, id TEXT, source_account_id TEXT, destinations TEXT, amount_resolution_json TEXT, end_date TEXT, annual_cap REAL, enabled INT);"
            "CREATE TABLE account_displays(user_id TEXT, account_id TEXT, display_json TEXT, PRIMARY KEY(user_id, account_id));"
        )
        charge = dict(resolver="expression", config=dict(expression="abs(p) * rate"), inputs=dict(p=dict(source="provider", provider="model-value", arguments=dict(id="p")), rate=dict(source="provider", provider="occurrence-rate", arguments=dict(annualRate=0.0399, volatility=0))))
        pay = dict(resolver="expression", config=dict(expression="91.08"), inputs={})
        c.executemany(
            "INSERT INTO recurrence_rules VALUES ('owner',?,?,?,?,NULL,NULL,1)",
            [("charge", "i", "null", json.dumps(charge)), ("pay", "cash", '["i","p"]', json.dumps(pay))],
        )
        grouped = {"name": "Loan", "components": [{"accountId": "p", "role": "principal"}, {"accountId": "i", "role": "interest"}], "interestScheduleId": "charge", "paymentScheduleId": "pay"}
        c.execute("INSERT INTO account_displays VALUES ('owner','p',?)", (json.dumps(grouped),))


class UpgradeTest(unittest.TestCase):
    def test_backfill_creates_missing_passthroughs_and_leaves_grouped(self):
        with tempfile.TemporaryDirectory() as directory:
            db, backup = Path(directory) / "db", Path(directory) / "backup"
            setup(db)
            module.upgrade(db, backup)
            with sqlite3.connect(db) as c, sqlite3.connect(backup) as b:
                for table in ("accounts", "recurrence_rules", "users"):
                    self.assertEqual(c.execute(f"SELECT * FROM {table}").fetchall(), b.execute(f"SELECT * FROM {table}").fetchall())
                rows = dict(c.execute("SELECT account_id, display_json FROM account_displays WHERE user_id='owner'").fetchall())
                self.assertEqual(set(rows), {"p", "cash"})
                grouped = json.loads(rows["p"])
                self.assertEqual(grouped["components"][1], dict(accountId="i", role="interest"))
                self.assertEqual(grouped["interestScheduleId"], "charge")
                cash = json.loads(rows["cash"])
                self.assertEqual(cash, dict(name="Cash", components=[dict(accountId="cash", role="primary")], interestScheduleId="", paymentScheduleId=""))
                other = dict(c.execute("SELECT account_id, display_json FROM account_displays WHERE user_id='other'").fetchall())
                self.assertEqual(set(other), {"solo"})
                solo = json.loads(other["solo"])
                self.assertEqual(solo["components"], [dict(accountId="solo", role="primary")])
                self.assertEqual(solo["interestScheduleId"], "")
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(OSError):
                module.upgrade(db, backup)
            second = Path(directory) / "again"
            module.upgrade(db, second)
            with sqlite3.connect(db) as c:
                rows = dict(c.execute("SELECT account_id, display_json FROM account_displays WHERE user_id='owner'").fetchall())
                self.assertEqual(set(rows), {"p", "cash"})

    def test_interest_without_row_is_not_backfilled(self):
        with tempfile.TemporaryDirectory() as directory:
            db, backup = Path(directory) / "db", Path(directory) / "backup"
            setup(db)
            module.upgrade(db, backup)
            with sqlite3.connect(db) as c:
                ids = {row[0] for row in c.execute("SELECT account_id FROM account_displays WHERE user_id='owner'").fetchall()}
                self.assertNotIn("i", ids)

    def test_empty_name_rolls_back_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            db, backup = Path(directory) / "db", Path(directory) / "backup"
            with sqlite3.connect(db) as c:
                c.executescript("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'); CREATE TABLE accounts(user_id TEXT, id TEXT, name TEXT, PRIMARY KEY(user_id,id)); INSERT INTO accounts VALUES ('owner','blank','   ');")
            with self.assertRaisesRegex(ValueError, "nonempty"):
                module.upgrade(db, backup)
            with sqlite3.connect(db) as c, sqlite3.connect(backup) as b:
                self.assertEqual(c.execute("SELECT name FROM sqlite_master WHERE name='account_displays'").fetchall(), [])
                self.assertEqual(c.execute("SELECT * FROM accounts").fetchall(), b.execute("SELECT * FROM accounts").fetchall())


if __name__ == "__main__":
    unittest.main()
