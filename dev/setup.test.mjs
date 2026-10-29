import test from "node:test";
import assert from "node:assert/strict";
import { validateSetup } from "./setup.mjs";

test("setup binds an account to its verified identity and keeps canonical ports fixed", () => {
  assert.throws(() => validateSetup({ account: "accounts/private" }), /only to refresh-db/);
  assert.doesNotThrow(() =>
    validateSetup({ from: "shared.db", "source-account": "accounts/reviewed-owner" }),
  );
  assert.throws(
    () => validateSetup({ "app-port": "5180" }),
    /Canonical ports are fixed/,
  );
});
