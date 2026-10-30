import test from "node:test";
import assert from "node:assert/strict";
import { validateRefresh } from "./refresh-db.mjs";

test("refresh requires explicit source and destination scopes before any service operation", () => {
  assert.throws(() => validateRefresh({}), /source-user/);
  assert.throws(() => validateRefresh({ "source-user": "users/source" }), /--user/);
  assert.doesNotThrow(() =>
    validateRefresh({ "source-user": "users/source", user: "users/owner" }),
  );
});
