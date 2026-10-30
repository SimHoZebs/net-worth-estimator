import { test } from "node:test";
import assert from "node:assert/strict";
import { Connection } from "../src/connection.js";
import { memoryStorage } from "./storage.js";

const tokens = {
  accessToken: "private-access",
  refreshToken: "private-refresh",
  expiresIn: 3600,
  status: "complete",
};
const identity = {
  authenticated: true,
  user: { name: "Planner" },
  resource: { id: "users/owner", permissions: ["user:read", "user:write"] },
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

test("device approval and browser restart use refresh credentials, never cookies", async () => {
  const storage = memoryStorage();
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/start"))
      return json({
        verificationUri: "https://identity.test/device",
        userCode: "CODE",
        deviceCode: "private-device",
        expiresIn: 600,
        interval: 5,
      });
    if (url.endsWith("/poll") || url.endsWith("/refresh")) return json(tokens);
    return json(identity);
  };
  const connection = new Connection(storage, request);
  const login = await connection.start("https://app.test");
  assert.deepEqual(login, { verificationUri: "https://identity.test/device", userCode: "CODE" });
  assert.equal(await connection.poll(), true);
  assert.ok((await storage.local.get("connection")).connection.refreshToken);
  assert.equal((await storage.local.get("access")).access, undefined);
  await storage.session.remove("access");
  await new Connection(storage, request).identity();
  assert.ok(requests.some((entry) => entry.url.endsWith("/refresh")));
  for (const entry of requests) {
    assert.equal(entry.options.credentials, "omit");
    assert.equal(entry.options.redirect, "error");
  }
  assert.equal(requests.at(-1).options.headers.Authorization, "Bearer private-access");
});

test("simultaneous calls share refresh and retain drafts on rejected credentials", async () => {
  const storage = memoryStorage();
  await storage.local.set({
    connection: { base: "https://app.test", refreshToken: "refresh" },
    draft: { name: "Keep" },
  });
  let refreshes = 0;
  const connection = new Connection(storage, async (url) => {
    if (url.endsWith("/refresh")) {
      refreshes++;
      return json(tokens);
    }
    return json(identity);
  });
  await Promise.all([connection.identity(), connection.identity()]);
  assert.equal(refreshes, 1);
  const denied = new Connection(storage, async () => json({ detail: "Reconnect" }, 401));
  await storage.session.remove("access");
  await assert.rejects(denied.identity(), /Reconnect/);
  assert.equal((await storage.local.get("draft")).draft.name, "Keep");
});

test("disconnect cannot be undone by an in-flight refresh", async () => {
  const storage = memoryStorage();
  await storage.local.set({ connection: { base: "https://app.test", refreshToken: "refresh" } });
  let resolve;
  const connection = new Connection(
    storage,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = connection.token();
  await new Promise(setImmediate);
  await connection.disconnect();
  resolve(json(tokens));
  await assert.rejects(pending, /connection changed/);
  assert.equal((await storage.local.get("connection")).connection, undefined);
});

test("a rejected old request cannot retry with a different app's credentials", async () => {
  const storage = memoryStorage();
  await storage.local.set({
    connection: { base: "https://old.test", refreshToken: "old-refresh" },
  });
  await storage.session.set({ access: { token: "old-access", expiresAt: Date.now() + 3600000 } });
  const requests = [];
  let rejectOld;
  const connection = new Connection(storage, async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1)
      return new Promise((resolve) => {
        rejectOld = resolve;
      });
    if (url.endsWith("/refresh")) return json(tokens);
    return json(identity);
  });
  const pending = connection.api("/v1/status");
  await new Promise(setImmediate);
  await connection.disconnect();
  await storage.local.set({
    connection: { base: "https://new.test", refreshToken: "new-refresh" },
  });
  rejectOld(json({ detail: "Expired" }, 401));
  await assert.rejects(pending, /connection changed/);
  assert.equal(requests.length, 1);
});
