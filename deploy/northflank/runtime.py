"""Northflank Sandbox process composition, not an application requirement.

Keep the learner loopback-only and on the existing data volume. A child exit
terminates the deployment so the platform restarts both processes together.

Seeded learner: when ML_SEED_PATH points at a baked seed database, it is
installed as ML_MODEL_PATH only if the live database is missing or shows
zero learning (empty events table, no drift review pending). A database
that already recorded feedback is never overwritten. ML_SEED_DISABLE=1
skips seeding. A corrupt live database fails loud so an operator decides.
"""
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request


def maybe_install_seed():
    """Install the baked learner seed iff the live database never learned.

    Returns True when the seed was installed, False when live state was
    kept or seeding is disabled/unavailable. Never raises: any failure
    leaves startup to proceed so the deployment fails loud downstream
    instead of masking storage problems with a silent skip.
    """
    seed = os.environ.get("ML_SEED_PATH", "")
    target = os.environ.get("ML_MODEL_PATH", "/data/ml.sqlite3")
    if os.environ.get("ML_SEED_DISABLE", "") == "1" or not seed:
        return False
    if not os.path.isfile(seed):
        print(f"northflank runtime: no seed at {seed}; keeping live learner state", flush=True)
        return False
    try:
        if os.path.isfile(target):
            db = sqlite3.connect(f"file:{target}?mode=ro", uri=True)
            try:
                events = db.execute("SELECT COUNT(*) FROM events").fetchone()[0]
                try:
                    row = db.execute(
                        "SELECT pending FROM drift WHERE id=1"
                    ).fetchone()
                    pending = row[0] if row else 0
                except sqlite3.Error:
                    pending = 0
            finally:
                db.close()
            if events > 0:
                print("northflank runtime: live learner has recorded feedback; keeping it", flush=True)
                return False
            if pending:
                print("northflank runtime: live learner has a pending drift review; keeping it", flush=True)
                return False
    except sqlite3.Error as exc:
        print(f"northflank runtime: live learner database unreadable ({exc}); refusing to overwrite", flush=True)
        return False
    try:
        os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
        # A live database previously opened in WAL mode leaves sidecars
        # beside the main file; replacing only the main file would wed
        # fresh seed content to stale WAL frames. Remove all three so the
        # install is a clean replace.
        for suffix in ("-wal", "-shm", "-journal"):
            try:
                os.unlink(target + suffix)
            except FileNotFoundError:
                pass
        shutil.copy2(seed, target)
    except OSError as exc:
        print(f"northflank runtime: seed install failed ({exc}); keeping live state", flush=True)
        return False
    print(f"northflank runtime: installed learner seed from {seed}", flush=True)
    return True


def run():
    children = []
    stopping = False

    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        maybe_install_seed()
        children.append(subprocess.Popen([
            sys.executable, "/app/ml/server.py", "--host", "127.0.0.1", "--port", "8766",
        ]))
        deadline = time.monotonic() + 75
        while not stopping:
            if children[0].poll() is not None:
                raise RuntimeError("ml provider exited during startup")
            try:
                with urllib.request.urlopen("http://127.0.0.1:8766/health", timeout=1) as response:
                    if response.status == 200:
                        break
            except (urllib.error.URLError, TimeoutError):
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError("ml provider did not become ready")
            time.sleep(0.1)
        if stopping:
            return 0
        children.append(subprocess.Popen(["/app/api-boot.sh"]))
        while not stopping:
            for child in children:
                if child.poll() is not None:
                    raise RuntimeError(f"deployment child exited with status {child.returncode}")
            time.sleep(0.1)
        return 0
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        deadline = time.monotonic() + 8
        for child in children:
            try:
                child.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    try:
        sys.exit(run())
    except Exception as exc:
        print(f"northflank runtime: {exc}", file=sys.stderr)
        sys.exit(1)
