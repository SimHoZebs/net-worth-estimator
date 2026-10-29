import test from "node:test";
import assert from "node:assert/strict";
import { validatePublish } from "./publish-sample.mjs";

test("publication explicitly selects reviewed source and cannot redirect its public destination", () => {
  assert.throws(() => validatePublish({}), /source-account/);
  assert.throws(
    () => validatePublish({ "source-account": "accounts/source", account: "accounts/private" }),
    /always targets/,
  );
  assert.doesNotThrow(() => validatePublish({ "source-account": "accounts/source" }));
});
