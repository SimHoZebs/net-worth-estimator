// Unit tests for e2e journey tracing. No Docker, no browser, no network:
// stub contexts prove saveTraces writes per-context archives, keeps
// recording across saves, and stays quiet without a trace directory.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { newTracedContext, saveTraces } from "./e2e-journeys.mjs";

function stubContext({ failStop = false } = {}) {
  const state = { starts: 0, stopped: [] };
  return {
    state,
    tracing: {
      start: async () => {
        state.starts += 1;
      },
      stop: async ({ path }) => {
        if (failStop) throw new Error("already stopped");
        writeFileSync(path, "stub trace");
        state.stopped.push(path);
      },
    },
  };
}

function stubBrowser() {
  const contexts = [];
  return {
    contexts,
    newContext: async () => {
      const context = stubContext();
      contexts.push(context);
      return context;
    },
  };
}

test("saves one archive per context and keeps recording", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nwe-e2e-traces-"));
  process.env.E2E_TRACE_DIR = directory;
  try {
    const browser = stubBrowser();
    await newTracedContext(browser);
    await newTracedContext(browser);
    const written = await saveTraces("first-failure");
    assert.equal(written.length, 2);
    assert.deepEqual(
      readdirSync(directory).sort(),
      written.map((path) => path.split("/").at(-1)).sort(),
    );
    for (const context of browser.contexts) {
      assert.equal(context.state.starts, 2, "recording restarts after a save");
      assert.equal(context.state.stopped.length, 1);
    }
    const again = await saveTraces("second-failure");
    assert.equal(again.length, 2);
    assert.ok(
      again.every((path) => !written.includes(path)),
      "successive saves must not collide",
    );
    assert.equal(readdirSync(directory).length, 4);
  } finally {
    delete process.env.E2E_TRACE_DIR;
  }
});

test("stays quiet without a trace directory", async () => {
  delete process.env.E2E_TRACE_DIR;
  const browser = stubBrowser();
  await newTracedContext(browser);
  assert.deepEqual(await saveTraces("failure"), []);
});

test("a failed stop is reported, not thrown", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nwe-e2e-traces-"));
  process.env.E2E_TRACE_DIR = directory;
  try {
    const failing = stubContext({ failStop: true });
    const browser = { newContext: async () => failing };
    await newTracedContext(browser);
    await saveTraces("failure");
    assert.deepEqual(failing.state.stopped, [], "failed stops record nothing");
  } finally {
    delete process.env.E2E_TRACE_DIR;
  }
});
