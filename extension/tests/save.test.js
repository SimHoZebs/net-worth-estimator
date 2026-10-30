import { test } from "node:test";
import assert from "node:assert/strict";
import { CaptureState } from "../src/state.js";
import { createPurchaseSaver } from "../src/save.js";
import { loadModel } from "../src/model.js";
import { memoryStorage } from "./storage.js";

async function fixture() {
  const storage = memoryStorage();
  const captures = new CaptureState(storage);
  await captures.edit({ name: "Desk", cost: "12.34", currency: "USD", fromId: "cash" });
  await storage.local.set({ connection: { base: "https://app.test" } });
  await captures.change((state) => {
    state.financialScope = "https://app.test|users/owner";
  });
  const identity = { resource: { id: "users/owner", permissions: ["user:write"] } };
  const model = {
    model: {
      accounts: [{ id: "cash", name: "Cash", kind: "cash", enabled: true }],
      plannedPurchases: [],
    },
  };
  return { storage, captures, identity, model };
}

test("unknown saves retry the same purchase UUID and recover duplicate-ID 409", async () => {
  const { storage, captures, identity, model } = await fixture();
  const payloads = [];
  const connection = {
    identity: async () => identity,
    api: async (path, payload) => {
      if (path === "/v1/status") return { readOnly: false };
      if (path === "/v1/financial-model") return model;
      assert.equal(path, "/v1/planned-purchases");
      payloads.push(structuredClone(payload));
      if (payloads.length === 1) {
        model.model.plannedPurchases.push({
          ...structuredClone(payload),
        });
        throw new Error("Network interrupted");
      }
      throw Object.assign(new Error("Duplicate ID"), { status: 409 });
    },
  };
  const save = createPurchaseSaver(connection, captures, storage);
  await Promise.all([assert.rejects(save(), /Network/), assert.rejects(save(), /Network/)]);
  assert.equal(payloads.length, 1);
  assert.ok((await captures.read()).pendingSave);
  await assert.rejects(captures.edit({ cost: "99" }), /pending save/);
  await createPurchaseSaver(connection, new CaptureState(storage), storage)();
  assert.deepEqual(payloads[1], payloads[0]);
  assert.equal((await captures.read()).saved.id, payloads[0].id);
  assert.equal((await captures.read()).pendingSave, undefined);
});

test("a different account cannot replay a pending purchase", async () => {
  const { storage, captures, identity, model } = await fixture();
  await captures.change((state) => {
    state.pendingSave = { base: "https://app.test", resource: "users/other", payload: {} };
  });
  let writes = 0;
  const connection = {
    identity: async () => identity,
    api: async (path) => {
      if (path === "/v1/financial-model") return model;
      if (path === "/v1/status") return { readOnly: false };
      writes++;
    },
  };
  await assert.rejects(createPurchaseSaver(connection, captures, storage)(), /another account/);
  assert.equal(writes, 0);
});

test("definitive first-attempt validation failures unlock the draft for correction", async () => {
  const { storage, captures, identity, model } = await fixture();
  const connection = {
    identity: async () => identity,
    api: async (path) => {
      if (path === "/v1/financial-model") return model;
      if (path === "/v1/status") return { readOnly: false };
      return { persisted: false, issues: [{ severity: "error", message: "Account unavailable" }] };
    },
  };
  await assert.rejects(createPurchaseSaver(connection, captures, storage)(), /Account unavailable/);
  assert.equal((await captures.read()).pendingSave, undefined);
  await captures.edit({ cost: "22" });
});

test("a conflicting saved purchase stays locked and never becomes a false success", async () => {
  const { storage, captures, identity, model } = await fixture();
  const connection = {
    identity: async () => identity,
    api: async (path, payload) => {
      if (path === "/v1/financial-model") return model;
      if (path === "/v1/status") return { readOnly: false };
      model.model.plannedPurchases = [{ ...payload, name: "Changed in the app" }];
      throw Object.assign(new Error("Duplicate ID"), { status: 409 });
    },
  };
  await assert.rejects(
    createPurchaseSaver(connection, captures, storage)(),
    /conflicts with saved data/,
  );
  assert.ok((await captures.read()).pendingSave);
  assert.equal((await captures.read()).saved, undefined);
});

test("retry rejections retain an earlier uncertain-save record", async () => {
  const { storage, captures, identity, model } = await fixture();
  let attempt = 0;
  const connection = {
    identity: async () => identity,
    api: async (path) => {
      if (path === "/v1/financial-model") return model;
      if (path === "/v1/status") return { readOnly: false };
      throw Object.assign(new Error("Rejected"), { status: ++attempt === 1 ? 503 : 422 });
    },
  };
  const save = createPurchaseSaver(connection, captures, storage);
  await assert.rejects(save());
  await assert.rejects(save());
  assert.ok((await captures.read()).pendingSave);
});

test("existing model/status reads expose only eligible account labels to the panel", async () => {
  const { model } = await fixture();
  model.model.accounts.push(
    { id: "debt", kind: "debt", enabled: true },
    { id: "off", kind: "cash", enabled: false },
    { id: "archived", kind: "cash", enabled: true, archived: true },
  );
  model.model.accounts[0].balance = "PRIVATE_BALANCE";
  const loaded = await loadModel(
    { api: async (path) => (path === "/v1/status" ? { readOnly: true } : model) },
    "users/owner",
  );
  assert.deepEqual(loaded.accounts, [{ id: "cash", name: "Cash" }]);
  assert.equal(loaded.readOnly, true);
  assert.doesNotMatch(JSON.stringify(loaded), /PRIVATE_BALANCE/);
});
