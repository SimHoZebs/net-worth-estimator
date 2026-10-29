import test from "node:test";
import assert from "node:assert/strict";
import { validateSetup } from "./setup.mjs";

test("setup binds a scope to its verified identity and keeps canonical ports fixed", () => {
  assert.throws(() => validateSetup({ account: "user:private" }), /only to refresh-db/);
  assert.throws(() => validateSetup({ plan: "plans/private" }), /only to refresh-db/);
  assert.throws(
    () => validateSetup({ "source-account": "a", "source-plan": "b" }),
    /conflict/,
  );
  assert.doesNotThrow(() =>
    validateSetup({ from: "shared.db", "source-account": "user:reviewed-owner" }),
  );
  assert.throws(
    () => validateSetup({ "app-port": "5180" }),
    /Canonical ports are fixed/,
  );
});
