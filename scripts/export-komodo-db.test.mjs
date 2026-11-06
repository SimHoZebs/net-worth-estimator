import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./export-komodo-db", import.meta.url));

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", [script, ...args], { encoding: "utf8" });
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

test("export script rejects a missing container", async () => {
  const { code, stderr } = await run(["--container", "net-worth-does-not-exist-xyz"]);
  assert.equal(code, 1);
  assert.match(stderr, /Container not found/);
});
