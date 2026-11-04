import test from "node:test";
import assert from "node:assert/strict";
import { validateDemo } from "./demo.mjs";

test("demo defaults to the safe-spending pack and reads its anchor", () => {
  assert.deepEqual(validateDemo({}), {
    pack: "safe-spending",
    anchor: "2026-01-31",
  });
});

test("demo accepts a known pack and rejects an unknown one", () => {
  assert.equal(
    validateDemo({ pack: "safe-spending-shortfall" }).anchor,
    "2026-02-10",
  );
  assert.throws(() => validateDemo({ pack: "missing" }), /does not exist/);
  assert.throws(() => validateDemo({ pack: "Not A Pack" }), /lowercase/);
});

test("demo rejects options owned by other commands", () => {
  assert.throws(() => validateDemo({ bulk: "1x1" }), /does not apply/);
  assert.throws(() => validateDemo({ user: "users/owner" }), /does not apply/);
  assert.throws(() => validateDemo({}, ["extra"]), /Unexpected/);
});
