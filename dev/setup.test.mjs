import test from "node:test";
import assert from "node:assert/strict";
import { validateSetup } from "./setup.mjs";

test("setup binds a plan to its verified identity and keeps canonical ports fixed", () => {
  assert.throws(() => validateSetup({ plan: "plans/private" }), /only to refresh-db/);
  assert.doesNotThrow(() =>
    validateSetup({ from: "shared.db", "source-plan": "plans/reviewed-owner" }),
  );
  assert.throws(
    () => validateSetup({ "app-port": "5180" }),
    /Canonical ports are fixed/,
  );
});
