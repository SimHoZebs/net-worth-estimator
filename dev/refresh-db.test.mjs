import test from "node:test";
import assert from "node:assert/strict";
import { validateRefresh } from "./refresh-db.mjs";

test("refresh requires explicit source and destination scopes before any service operation", () => {
  assert.throws(() => validateRefresh({}), /source-account/);
  assert.throws(() => validateRefresh({ "source-account": "user:source" }), /--account/);
  assert.throws(
    () => validateRefresh({ "source-account": "user:source", account: "sample" }),
    /private account/,
  );
  assert.throws(
    () => validateRefresh({ "source-plan": "plans/source", plan: "plans/sample" }),
    /private account/,
  );
  assert.throws(
    () => validateRefresh({ "source-account": "a", "source-plan": "b", account: "c" }),
    /conflict/,
  );
  assert.throws(
    () => validateRefresh({ account: "a", plan: "b", "source-account": "c" }),
    /conflict/,
  );
  assert.doesNotThrow(() =>
    validateRefresh({ "source-account": "user:source", account: "user:owner" }),
  );
  assert.doesNotThrow(() =>
    validateRefresh({ "source-plan": "plans/source", plan: "plans/owner" }),
  );
});
