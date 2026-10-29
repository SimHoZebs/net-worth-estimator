import test from "node:test";
import assert from "node:assert/strict";
import { validateRefresh } from "./refresh-db.mjs";

test("refresh requires explicit source and destination scopes before any service operation", () => {
  assert.throws(() => validateRefresh({}), /source-account/);
  assert.throws(() => validateRefresh({ "source-account": "accounts/source" }), /--account/);
  assert.throws(
    () => validateRefresh({ "source-account": "accounts/source", account: "accounts/sample" }),
    /private account/,
  );
  assert.doesNotThrow(() =>
    validateRefresh({ "source-account": "accounts/source", account: "accounts/owner" }),
  );
});
