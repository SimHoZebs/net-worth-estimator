#!/usr/bin/env python3
"""Backfill passthrough displays for accounts that lack visible coverage."""
import argparse
import json
import os
import sqlite3
from pathlib import Path

DDL = """CREATE TABLE IF NOT EXISTS account_displays (
user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
account_id TEXT NOT NULL, display_json TEXT NOT NULL,
PRIMARY KEY(user_id, account_id),
FOREIGN KEY(user_id, account_id) REFERENCES accounts(user_id, id)
ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED)"""


def passthrough(account_id, name):
    return {
        "name": name,
        "components": [{"accountId": account_id, "role": "primary"}],
        "interestScheduleId": "",
        "paymentScheduleId": "",
    }


def upgrade(database, backup):
    database, backup = Path(database), Path(backup)
    if not database.is_file():
        raise ValueError("The source database must exist")
    # Exclusive creation prevents a repeated command from replacing a backup.
    fd = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    with sqlite3.connect(f"file:{database}?mode=rw", uri=True) as db:
        db.execute("PRAGMA foreign_keys=ON")
        with sqlite3.connect(backup) as target:
            db.backup(target)
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute(DDL)
            users = [row[0] for row in db.execute("SELECT id FROM users")]
            for user in users:
                accounts = db.execute(
                    "SELECT id, name FROM accounts WHERE user_id=?", (user,)
                ).fetchall()
                displays = db.execute(
                    "SELECT account_id, display_json FROM account_displays WHERE user_id=?",
                    (user,),
                ).fetchall()
                owners = {row[0] for row in displays}
                claimed = set()
                for _, data in displays:
                    try:
                        payload = json.loads(data)
                    except (TypeError, ValueError):
                        raise ValueError("Stored display is not valid JSON")
                    for component in payload.get("components", []):
                        claimed.add(component.get("accountId"))
                for account_id, name in accounts:
                    if account_id in owners or account_id in claimed:
                        continue
                    if not (name or "").strip():
                        raise ValueError("Account name must be nonempty for a passthrough display")
                    db.execute(
                        "INSERT INTO account_displays (user_id, account_id, display_json) VALUES (?,?,?)",
                        (user, account_id, json.dumps(passthrough(account_id, name))),
                    )
            violations = db.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise ValueError("Foreign key verification failed")
            db.commit()
        except BaseException:
            db.rollback()
            raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    parser.add_argument("--backup", required=True)
    args = parser.parse_args()
    upgrade(args.db, args.backup)
