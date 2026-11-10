import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./export-komodo-db", import.meta.url));

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", [script, ...args], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("export script prints usage on --help", async () => {
  const { code, stdout } = await run(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: scripts\/export-komodo-db/);
  assert.match(stdout, /--stop/);
});

test("export script rejects unknown options", async () => {
  const { code, stderr } = await run(["--nope"]);
  assert.equal(code, 2);
  assert.match(stderr, /Unknown option/);
});

test("export script rejects a relative database path", async () => {
  const { code, stderr } = await run(["--db", "relative.db"]);
  assert.equal(code, 2);
  assert.match(stderr, /absolute/);
});

test("export script rejects a missing container using only disposable state", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-export-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "docker"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  const { code, stderr } = await run([
    "--container", "net-worth-does-not-exist-xyz", "--dest", join(directory, "backup"),
  ], { PATH: directory + delimiter + process.env.PATH });
  assert.equal(code, 1);
  assert.match(stderr, /Container not found/);
});
