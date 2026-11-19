import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const script = new URL("./ci-changed-paths.sh", import.meta.url).pathname;
const classifier = new URL("./ci-code-gate.mjs", import.meta.url).pathname;
const zeros = "0".repeat(40);

function git(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

function write(dir, path, content = "content\n") {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function gate(dir, env) {
  const result = spawnSync("bash", [script], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      CI_CLASSIFIER: classifier,
      EVENT_NAME: "push",
      BEFORE: "",
      BASE_SHA: "",
      HEAD_SHA: "",
      SHA: "",
      DEFAULT_BRANCH: "main",
      ...env,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("push and PR ranges classify first pushes, mixed changes and force pushes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nwe-ci-paths-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, "init", "-q");
  git(dir, "checkout", "-q", "-b", "main");
  git(dir, "config", "user.email", "ci@example.test");
  git(dir, "config", "user.name", "CI");
  write(dir, "README.md");
  write(dir, "backend/main.go");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  const main = git(dir, "rev-parse", "HEAD");

  // Exact user case: first push of a docs-only feature branch has an all-zero
  // "before". The merge base with main gives a two-dot range of docs commits.
  git(dir, "checkout", "-q", "-b", "docs-only");
  write(dir, "docs/guide.md");
  write(dir, "docs/diagrams/flow.mmd");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "docs");
  const docsHead = git(dir, "rev-parse", "HEAD");
  const firstPush = { BEFORE: zeros, SHA: docsHead };
  assert.equal(gate(dir, firstPush), "false");
  assert.equal(gate(dir, { EVENT_NAME: "pull_request", BASE_SHA: main, HEAD_SHA: docsHead }), "false");

  // Mixed first push: one code file anywhere in the new commits runs gates.
  write(dir, "backend/extra.go");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "code");
  const mixedHead = git(dir, "rev-parse", "HEAD");
  assert.equal(gate(dir, { BEFORE: zeros, SHA: mixedHead }), "true");
  assert.equal(gate(dir, { EVENT_NAME: "pull_request", BASE_SHA: main, HEAD_SHA: mixedHead }), "true");

  // Normal push on an existing branch uses the two-dot before..head range.
  git(dir, "checkout", "-q", "-b", "existing", main);
  write(dir, "docs/one.md");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "docs one");
  const existingBefore = git(dir, "rev-parse", "HEAD");
  write(dir, "docs/two.md");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "docs two");
  const existingHead = git(dir, "rev-parse", "HEAD");
  assert.equal(gate(dir, { BEFORE: existingBefore, SHA: existingHead }), "false");
  write(dir, "frontend/app.ts");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "code two");
  assert.equal(gate(dir, { BEFORE: existingHead, SHA: git(dir, "rev-parse", "HEAD") }), "true");

  // Force push: "before" is not an ancestor of "head", so neither direction
  // is trusted and the gates run.
  git(dir, "checkout", "-q", "-b", "diverged-a", main);
  write(dir, "docs/a.md");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "a");
  const divergedA = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "-q", "-b", "diverged-b", main);
  write(dir, "docs/b.md");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "b");
  const divergedB = git(dir, "rev-parse", "HEAD");
  assert.equal(gate(dir, { BEFORE: divergedA, SHA: divergedB }), "true");
  assert.equal(gate(dir, { BEFORE: divergedB, SHA: divergedA }), "true");

  // Ambiguous ranges and manual dispatch also run the gates.
  assert.equal(gate(dir, { BEFORE: zeros, SHA: "deadbeef".repeat(5) }), "true");
  assert.equal(gate(dir, { EVENT_NAME: "workflow_dispatch", SHA: docsHead }), "true");
  assert.equal(
    gate(dir, { EVENT_NAME: "pull_request", BASE_SHA: "", HEAD_SHA: docsHead }),
    "true",
  );
});
