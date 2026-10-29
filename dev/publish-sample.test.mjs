import test from "node:test";
import assert from "node:assert/strict";
import { validatePublish } from "./publish-sample.mjs";

test("publication explicitly selects reviewed source and cannot redirect its public destination", () => {
  assert.throws(() => validatePublish({}), /source-account/);
  assert.throws(
    () => validatePublish({ "source-account": "user:source", account: "user:private" }),
    /always targets/,
  );
  assert.throws(
    () => validatePublish({ "source-account": "a", "source-plan": "b" }),
    /conflict/,
  );
  assert.throws(
    () => validatePublish({ "source-plan": "plans/source", plan: "plans/private" }),
    /always targets/,
  );
  assert.doesNotThrow(() => validatePublish({ "source-account": "user:source" }));
  assert.doesNotThrow(() => validatePublish({ "source-plan": "plans/source" }));
});
