import test from "node:test";
import assert from "node:assert/strict";
import { validatePublish } from "./publish-sample.mjs";

test("publication explicitly selects reviewed source and cannot redirect its public destination", () => {
  assert.throws(() => validatePublish({}), /source-plan/);
  assert.throws(
    () => validatePublish({ "source-plan": "plans/source", plan: "plans/private" }),
    /always targets/,
  );
  assert.doesNotThrow(() => validatePublish({ "source-plan": "plans/source" }));
});
