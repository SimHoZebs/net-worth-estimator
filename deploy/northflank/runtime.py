"""Northflank Sandbox process composition, not an application requirement.

Keep the learner loopback-only and on the existing data volume. A child exit
terminates the deployment so the platform restarts both processes together.
"""
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request


def run():
    children = []
    stopping = False

    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
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
