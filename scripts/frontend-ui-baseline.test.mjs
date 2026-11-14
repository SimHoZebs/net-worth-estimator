import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);

test("empty UI baseline skips provisioning but explicit selectors still fail", async (t) => {
  const scratch = join(homedir(), ".local/share/opencode/scratch");
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(scratch, "ui-baseline-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "tests/integration"), { recursive: true });
  const runner = join(root, "scripts/test-integration.mjs");
  await copyFile(new URL("../frontend/scripts/test-integration.mjs", import.meta.url), runner);

  for (const args of [[], ["--shard=1/4"], ["--shards=4"]]) {
    const { stdout } = await exec(process.execPath, [runner, ...args]);
    assert.match(stdout, /empty baseline/);
    assert.match(stdout, /no servers started/);
  }
  for (const args of [
    ["deleted.spec.ts"],
    ["--grep", "missing"],
    ["--grep=missing"],
    ["--grep-invert", "missing"],
    ["--grep-invert=missing"],
    ["-g", "missing"],
    ["-gmissing"],
  ]) {
    await assert.rejects(exec(process.execPath, [runner, ...args]), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /explicit selector matched nothing/);
      return true;
    });
  }
  await rm(join(root, "tests/integration"), { recursive: true });
  await assert.rejects(exec(process.execPath, [runner]), (error) => {
    assert.match(error.stderr, /ENOENT/);
    assert.doesNotMatch(error.stdout, /empty baseline/);
    return true;
  });
});
