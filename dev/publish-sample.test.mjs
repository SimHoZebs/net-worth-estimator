import test from "node:test";
import assert from "node:assert/strict";
import { validatePublish } from "./publish-sample.mjs";

test("publication explicitly selects reviewed source and the provisioned guest destination", () => {
  assert.throws(() => validatePublish({}), /source-user/);
  assert.throws(
    () => validatePublish({ "source-user": "users/source" }),
    /provisioned guest scope/,
  );
  assert.throws(
    () => validatePublish({ "source-user": "users/source", user: "users/owner" }),
    /provisioned guest scope/,
  );
  assert.doesNotThrow(() =>
    validatePublish({ "source-user": "users/source", user: `users/${"a".repeat(64)}` }),
  );
});
