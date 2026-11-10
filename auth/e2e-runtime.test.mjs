import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createRuntime } from "./e2e-runtime.mjs";

test("deadline kills a hanging command and still permits bounded cleanup", async () => {
  const work = createRuntime(100);
  try {
    await assert.rejects(work.command(process.execPath, ["-e", "setInterval(() => {}, 1000)"]), /deadline exceeded/);
    await assert.rejects(work.command(process.execPath, ["-e", "process.exit(0)"]), /deadline exceeded/);
  } finally { work.dispose(); }
  const cleanup = createRuntime(5000);
  try {
    assert.equal(await cleanup.command(process.execPath, ["-e", "process.stdout.write('clean')"]), "clean");
  } finally { cleanup.dispose(); }
});

test("deadline interrupts an unanswered readiness request", async (t) => {
  const server = createServer(() => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const runtime = createRuntime(100);
  try {
    await assert.rejects(runtime.waitFor(`http://127.0.0.1:${server.address().port}`), /deadline exceeded/);
  } finally { runtime.dispose(); }
});

test("command startup and nonzero exits propagate", async () => {
  const runtime = createRuntime(5000);
  try {
    await assert.rejects(runtime.command("/nonexistent-e2e-command", []), /ENOENT/);
    await assert.rejects(runtime.command(process.execPath, ["-e", "process.exit(23)"]), /exited 23/);
  } finally { runtime.dispose(); }
});
