#!/usr/bin/env python3
"""Offline, explicit income finding upgrade. Never imported by runtime/setup.

Stop writers. A new private backup is mandatory. Immutable feedback payloads,
owner answers, finding IDs, and financial tables are preserved byte-identical.
Only current finding summaries and analyzer ownership change; rerun supplies
fresh evidence requests. Configure a fresh River DB separately (see README).
"""
import argparse
import json
import os
import sqlite3
from pathlib import Path


def upgrade(database, backup):
    database, backup = Path(database), Path(backup)
    if not database.is_file():
        raise ValueError("application database must exist")
    fd = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    db = sqlite3.connect(database)
    try:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or db.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("database integrity failed")
        with sqlite3.connect(backup) as target:
            db.backup(target)
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM analysis_runs WHERE state='running' LIMIT 1").fetchone():
            raise ValueError("stop workers and resolve running claims before upgrade")
        if db.execute("SELECT 1 FROM analysis_runs WHERE type='payments' LIMIT 1").fetchone():
            raise ValueError("payment analyzer already exists; inspect target before upgrade")
        rows = db.execute("SELECT user_id,id,detection_json FROM analysis_findings WHERE analysis_type='income'").fetchall()
        for owner, finding_id, raw in rows:
            detection = json.loads(raw)
            if detection.get("kind") != "income" or "income" not in detection or "pattern" in detection:
                raise ValueError("unexpected income finding shape")
            detection["pattern"] = detection.pop("income")
            detection.pop("judgmentInput", None)
            detection.pop("judgment", None)
            db.execute("UPDATE analysis_findings SET analysis_type='payments', detection_json=? WHERE user_id=? AND id=?", (json.dumps(detection, separators=(",", ":")), owner, finding_id))
        db.execute("UPDATE analysis_runs SET type='payments' WHERE type='income'")
        if db.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("upgrade violates foreign keys")
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database")
    parser.add_argument("backup", help="new backup file, must not exist")
    args = parser.parse_args()
    upgrade(args.database, args.backup)
