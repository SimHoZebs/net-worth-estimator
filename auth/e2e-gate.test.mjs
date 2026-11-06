// Contract tests for the disposable e2e gate. No Docker, no network, no
// credentials: budget, flake policy, teardown checks, and the fixture
// contract stay pinned here so drift fails fast in the unit tier.
import assert from "node:assert/strict";
import test from "node:test";
import {
  E2E_BUDGET_SECONDS,
  E2E_DISPOSABLE_MARKER,
  E2E_QUARANTINE,
  E2E_SEED,
  E2E_STEPS,
  E2E_TRANSPORT_ATTEMPTS,
  isQuarantined,
  teardownChecks,
  validateFixtureContract,
} from "./e2e-lib.mjs";

test("budget fits a pre-release/nightly cadence, not per-push", () => {
  assert.ok(E2E_BUDGET_SECONDS >= 900, "budget must cover cold image builds plus journeys");
  assert.ok(E2E_BUDGET_SECONDS <= 3600, "budget must stay bounded so a hung provider fails loudly");
});

test("retry budget covers transport only, never assertions", () => {
  assert.ok(E2E_TRANSPORT_ATTEMPTS >= 2 && E2E_TRANSPORT_ATTEMPTS <= 5);
});

test("quarantine list is explicit and names an owner per entry", () => {
  assert.ok(Array.isArray(E2E_QUARANTINE));
  for (const entry of E2E_QUARANTINE) {
    assert.ok(E2E_STEPS.includes(entry.step), `quarantined step must be a known step: ${entry.step}`);
    assert.ok(entry.reason && entry.owner && entry.since, "quarantine needs reason, owner, and since");
  }
});

test("journey steps cover every required boundary", () => {
  for (const step of [
    "fixture",
    "images",
    "stack",
    "isolation",
    "direct-share",
    "group-feed",
    "receipts",
    "migration",
    "proxy-headers",
    "teardown",
  ]) {
    assert.ok(E2E_STEPS.includes(step), `missing step ${step}`);
  }
  assert.ok(!isQuarantined("isolation"), "isolation must always gate");
});

test("seed is deterministic and frozen: fixed dates and names", () => {
  assert.equal(E2E_SEED.transactionDay, "2026-06-15");
  assert.ok(Number.isFinite(E2E_SEED.postedTime));
  assert.ok(E2E_SEED.ownerName && E2E_SEED.secondName && E2E_SEED.groupName);
  assert.ok(Object.isFrozen(E2E_SEED), "the journey seed must stay immutable");
});

test("teardown checks scope every Docker object class to the run id", () => {
  const checks = teardownChecks("testrun-1");
  const names = checks.map((check) => check.name);
  assert.deepEqual(names, ["containers", "volumes", "networks"]);
  for (const check of checks) {
    assert.ok(check.argv.join(" ").includes("testrun-1"), "checks must scope to the run id");
    assert.equal(check.expectEmpty, true, "any survivor must fail the gate");
  }
  const other = teardownChecks("testrun-2");
  assert.ok(!other[0].argv.join(" ").includes("testrun-1"), "run ids must not collide");
});

test("fixture contract rejects shared or production-like state", () => {
  const good = {
    testOnly: true,
    disposable: E2E_DISPOSABLE_MARKER,
    stateDir: "/tmp/opencode/e2e-x/casdoor",
    settings: { publicUrl: "http://127.0.0.1:1" },
    subject: "owner-sub",
    guestSubject: "guest-sub",
    username: "e2e-owner",
  };
  assert.deepEqual(validateFixtureContract(good, {
    stateDir: "/tmp/opencode/e2e-x/casdoor",
    issuer: "http://127.0.0.1:1",
  }), []);
  assert.ok(validateFixtureContract({ ...good, testOnly: false }).length > 0);
  assert.ok(validateFixtureContract({ ...good, disposable: "other" }).length > 0);
  assert.ok(validateFixtureContract({ ...good, guestSubject: "owner-sub" }).length > 0);
  assert.ok(validateFixtureContract({ ...good, subject: "" }).length > 0);
  assert.ok(validateFixtureContract(null).length > 0);
  assert.ok(
    validateFixtureContract(good, { stateDir: "/elsewhere", issuer: "http://127.0.0.1:1" }).length > 0,
    "state outside the disposable root must fail",
  );
});
