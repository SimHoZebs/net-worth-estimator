import test from "node:test";
import assert from "node:assert/strict";
import { actorResource, validateSeed } from "./seed.mjs";

test("seed requires exactly one of bulk or clear before any service operation", () => {
  assert.throws(() => validateSeed({}, []), /exactly one/);
  assert.throws(() => validateSeed({ pack: "safe-spending" }, []), /only to demo/);
  assert.throws(() => validateSeed({ bulk: "nope" }, []), /NxM/);
  assert.throws(() => validateSeed({ bulk: "3x5:abc" }, []), /NxM/);
  assert.throws(() => validateSeed({ bulk: "20x200", clear: true }, []), /exactly one/);
  assert.doesNotThrow(() => validateSeed({ bulk: "20x200" }, []));
  assert.doesNotThrow(() => validateSeed({ clear: true }, []));
  assert.throws(() => validateSeed({ clear: true, user: "owner" }, []), /users\/<64hex>/);
  assert.doesNotThrow(() =>
    validateSeed({ clear: true, user: `users/${"0".repeat(64)}` }, []),
  );
});

test("seed resource derives the owner scope from issuer and subject", () => {
  const resource = actorResource("https://issuer.test", "owner-subject");
  assert.match(resource, /^users\/[0-9a-f]{64}$/);
  assert.notEqual(
    resource,
    actorResource("https://issuer.test", "other-subject"),
  );
});
