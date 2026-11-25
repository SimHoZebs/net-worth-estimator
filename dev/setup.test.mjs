import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { pickFreePorts, usedSlotPorts } from "./lib/slots.mjs";
import { resolveSetupScope, validateSetup } from "./setup.mjs";

test("new slot setup rejects an explicit port that is already listening", async () => {
  const slot = `preflight-${process.pid}-${Date.now()}`;
  const [appPort, authPort, backendPort] = await pickFreePorts(3, [
    ...(await usedSlotPorts(slot)),
  ]);
  const server = createServer();
  server.listen(appPort, "127.0.0.1");
  await once(server, "listening");
  try {
    await assert.rejects(
      () =>
        resolveSetupScope({
          slot,
          "app-port": String(appPort),
          "auth-port": String(authPort),
          "backend-port": String(backendPort),
        }),
      /already in use on a loopback address/,
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("setup binds a user to its verified identity and keeps canonical ports fixed", () => {
  assert.throws(() => validateSetup({ user: "users/private" }), /only to refresh-db/);
  assert.throws(() => validateSetup({ bulk: "20x200" }), /only to seed/);
  assert.throws(() => validateSetup({ clear: true }), /only to seed/);
  assert.throws(() => validateSetup({ pack: "safe-spending" }), /only to demo/);
  assert.doesNotThrow(() =>
    validateSetup({ from: "shared.db", "source-user": "users/reviewed-owner" }),
  );
  assert.throws(
    () => validateSetup({ "app-port": "5180" }),
    /Canonical ports are fixed/,
  );
});
