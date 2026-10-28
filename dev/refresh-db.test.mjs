import test from "node:test";
import assert from "node:assert/strict";
import { validateRefresh } from "./refresh-db.mjs";

test("refresh requires explicit source and destination scopes before any service operation", () => {
  assert.throws(() => validateRefresh({}), /source-plan/);
  assert.throws(() => validateRefresh({ "source-plan": "plans/source" }), /--plan/);
  assert.throws(
    () => validateRefresh({ "source-plan": "plans/source", plan: "plans/sample" }),
    /private plan/,
  );
  assert.doesNotThrow(() =>
    validateRefresh({ "source-plan": "plans/source", plan: "plans/owner" }),
  );
});
