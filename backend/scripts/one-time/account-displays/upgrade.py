#!/usr/bin/env python3
"""Explicit additive schema upgrade and optional reviewed loan relationship."""
import argparse
import json
import math
import os
import re
import sqlite3
from pathlib import Path

DDL = """CREATE TABLE IF NOT EXISTS account_displays (
user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
account_id TEXT NOT NULL, display_json TEXT NOT NULL,
PRIMARY KEY(user_id, account_id),
FOREIGN KEY(user_id, account_id) REFERENCES accounts(user_id, id)
ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED)"""


def supported_rules(principal, charge, payment):
    """Freeze the loan form's current round-trip contract for operator linking."""
    interest_amount, payment_amount = (json.loads(row[2]) for row in (charge, payment))
    if any(row[3] is not None or row[4] is not None for row in (charge, payment)):
        return False
    if any(amount.get("resolver") != "expression" for amount in (interest_amount, payment_amount)):
        return False
    inputs = interest_amount.get("inputs") or {}
    if len(inputs) != 2 or payment_amount.get("inputs"):
        return False
    principal_input = rate_input = None
    for key, value in inputs.items():
        args = value.get("arguments") or {}
        if value.get("source") != "provider":
            return False
        if value.get("provider") == "model-value" and args == {"id": principal}:
            principal_input = key
        elif value.get("provider") == "occurrence-rate" and set(args) == {"annualRate", "volatility"}:
            rate = args["annualRate"]
            if not isinstance(rate, (int, float)) or not math.isfinite(rate) or not 0 <= rate <= 1 or args["volatility"] != 0:
                return False
            rate_input = key
        else:
            return False
    expression = interest_amount.get("config", {}).get("expression", "")
    if not principal_input or not rate_input or "".join(expression.split()) != f"abs({principal_input})*{rate_input}":
        return False
    try:
        literal = payment_amount["config"]["expression"].strip()
        if not re.fullmatch(r"-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?", literal, re.IGNORECASE | re.ASCII):
            return False
        amount = float(literal)
    except (KeyError, TypeError, ValueError):
        return False
    return math.isfinite(amount) and 0 <= amount <= 1e10 and round(amount * 100) / 100 == amount


def upgrade(database, backup, link=None):
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
            if link:
                user, principal, interest = (link[k] for k in ("userId", "principalId", "interestId"))
                charge, payment = (link[k] for k in ("interestScheduleId", "paymentScheduleId"))
                if principal == interest or charge == payment or not link["name"].strip():
                    raise ValueError("Use distinct account and rule IDs and a nonempty name")
                members = db.execute("SELECT id, kind, enabled, max_balance FROM accounts WHERE user_id=? AND id IN (?,?)", (user, principal, interest)).fetchall()
                if len(members) != 2 or any(a[1] != "debt" or a[3] != 0 for a in members) or members[0][2] != members[1][2]:
                    raise ValueError("Both components must be debt accounts with equal inclusion and zero ceilings")
                for (data,) in db.execute("SELECT display_json FROM account_displays WHERE user_id=?", (user,)):
                    if any(c["accountId"] in (principal, interest) for c in json.loads(data)["components"]):
                        raise ValueError("A component already belongs to a visible account")
                rules = dict((r[0], r[1:]) for r in db.execute("SELECT id, source_account_id, destinations, amount_resolution_json, end_date, annual_cap, enabled FROM recurrence_rules WHERE user_id=? AND id IN (?,?)", (user, charge, payment)))
                if charge not in rules or payment not in rules or rules[charge][0] != interest or json.loads(rules[charge][1] or "null") not in (None, []) or json.loads(rules[payment][1] or "null") != [interest, principal]:
                    raise ValueError("Rules must charge interest and pay interest before principal")
                funding = db.execute("SELECT kind FROM accounts WHERE user_id=? AND id=?", (user, rules[payment][0])).fetchone()
                if not funding or funding[0] == "debt":
                    raise ValueError("The loan form requires an existing non-debt payment funding account")
                if not supported_rules(principal, rules[charge], rules[payment]) or any(rules[r][5] != members[0][2] for r in (charge, payment)):
                    raise ValueError("The loan form requires principal-only periodic simple interest and a fixed payment with matching inclusion, no caps, and no end dates")
                display = {"name": link["name"].strip(), "components": [{"accountId": principal, "role": "principal"}, {"accountId": interest, "role": "interest"}], "interestScheduleId": charge, "paymentScheduleId": payment}
                db.execute("INSERT INTO account_displays VALUES (?,?,?)", (user, principal, json.dumps(display)))
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
    parser.add_argument("--link", help="Reviewed JSON file with explicit user, account, rule IDs and name")
    args = parser.parse_args()
    upgrade(args.db, args.backup, json.loads(Path(args.link).read_text()) if args.link else None)
