import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { run, validateCheck } from "./check.mjs";
import { pickFreePorts, usedSlotPorts } from "./lib/slots.mjs";

async function reservePort(host = "127.0.0.1") {
  const server = createServer();
  server.listen(0, host);
  await once(server, "listening");
  const port = server.address().port;
  return {
    port,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

test("check requires one valid loopback port and rejects other command options", () => {
  assert.deepEqual(validateCheck({ port: "8765" }), { port: 8765 });
  assert.throws(() => validateCheck({}), /--port N is required/);
  assert.throws(() => validateCheck({ port: "80" }), /1024 to 65535/);
  assert.throws(() => validateCheck({ port: "65536" }), /1024 to 65535/);
  assert.throws(() => validateCheck({ port: "8765", slot: "shots" }), /does not apply/);
  assert.throws(() => validateCheck({ port: "8765" }, ["extra"]), /Unexpected/);
});

test("check accepts an unreserved free loopback port", async () => {
  const [port] = await pickFreePorts(1, [...(await usedSlotPorts())]);
  await assert.doesNotReject(() => run({ port: String(port) }));
});

test("check rejects a port that is already listening", async () => {
  const server = await reservePort();
  try {
    await assert.rejects(() => run({ port: String(server.port) }), /already in use on a loopback address/);
  } finally {
    await server.close();
  }
});

test("check rejects a port that is already listening on IPv6 loopback", async () => {
  const server = await reservePort("::1");
  try {
    await assert.rejects(() => run({ port: String(server.port) }), /already in use on a loopback address/);
  } finally {
    await server.close();
  }
});

test("check rejects a port reserved by a dev stack even when it is free", async () => {
  await assert.rejects(() => run({ port: "5178" }), /reserved by a dev stack/);
});
