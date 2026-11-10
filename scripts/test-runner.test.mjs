import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;

async function record(t, args, fail = "") {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-runner-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, "commands.jsonl");
  const stub = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
const command = [basename(process.argv[1]), ...process.argv.slice(2)];
appendFileSync(process.env.COMMAND_LOG, JSON.stringify(command) + '\\n');
if (process.env.COMMAND_FAIL && command.join(' ').includes(process.env.COMMAND_FAIL)) process.exit(23);
`;
  // .mjs symlinks are unnecessary: the stub uses Node's module auto-detection.
  for (const name of ["node", "bun", "go", "gofmt"]) await writeFile(join(directory, name), stub, { mode: 0o700 });
  const result = await exec("bash", ["scripts/test", ...args], {
    cwd: root,
    env: { ...process.env, PATH: directory + delimiter + process.env.PATH,
      COMMAND_LOG: log, COMMAND_FAIL: fail, KEEP_GATE_LOGS: "", E2E_TEST_MUTATIONS: "1" },
  }).then(() => 0, (error) => error.code);
  const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  return { result, calls };
}

test("unit and completion commands execute the same contract inventory once", async (t) => {
  const unit = await record(t, ["--unit"]);
  const gate = await record(t, ["--gate", "--no-browser", "--without-backend"]);
  assert.equal(unit.result, 0);
  assert.equal(gate.result, 0);
  const contracts = (calls) => calls.filter((call) => call[0] === "node" && call[1] === "--test");
  assert.equal(contracts(unit.calls).length, 1);
  assert.equal(contracts(gate.calls).length, 1);
  assert.deepEqual(contracts(gate.calls), contracts(unit.calls));
  for (const file of ["auth/e2e-tracing.test.mjs", "auth/e2e-runtime.test.mjs", "deploy/migrations.test.mjs", "deploy/analysis-migration.test.mjs"])
    assert.ok(contracts(unit.calls)[0].includes(file), file);
});

test("matrix runs Go per identity and browsers once per pack", async (t) => {
  const { calls, result } = await record(t, ["--matrix", "--browser", "--packs=base,unicode", "--identities=full,duo,solo"]);
  assert.equal(result, 0);
  assert.equal(calls.filter((call) => call[0] === "go").length, 6);
  assert.equal(calls.filter((call) => call.includes("test:integration")).length, 2);
});

test("completion includes both browser suites and propagates group failures", async (t) => {
  const gate = await record(t, ["--gate", "--without-backend"]);
  assert.equal(gate.result, 0);
  assert.equal(gate.calls.filter((call) => call.includes("test:browser") && call.includes("./extension")).length, 1);
  for (const failure of ["--test", "./frontend typecheck", "@waypoint/auth lint", "./extension test", "test:integration"]) {
    const run = await record(t, ["--gate", "--without-backend"], failure);
    assert.notEqual(run.result, 0, failure);
  }
  assert.notEqual((await record(t, ["--unit"], "--test")).result, 0);
  assert.notEqual((await record(t, ["--matrix", "--browser"], "test:integration")).result, 0);
});
