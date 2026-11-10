// Shared end-to-end gate constants and pure helpers.
//
// The disposable e2e gate (auth/test-e2e.mjs) and its contract tests both
// import from here. Nothing in this file touches Docker, the network, or the
// filesystem: flake policy, runtime budget, teardown checks, and the
// disposable-fixture contract live here so they stay reviewable in one place.

export const E2E_DISPOSABLE_MARKER = "waypoint-e2e-v1";

// Wall-clock budget for one gate run, cold image builds included. The gate is
// slower than unit/integration by construction (two image builds, a real
// provider, real browser journeys), so it runs pre-release and nightly —
// never per push. Keep the value generous enough that a slow CI disk does not
// turn the gate into a coin toss, and tight enough that a hung provider fails
// loudly instead of wedging the release.
export const E2E_BUDGET_SECONDS = 1800;

// Retry budget. Only transport-level browser steps (navigation, readiness
// polling) may retry, at most this many attempts total. Assertion failures
// never retry: a failed assertion is signal, not flake.
export const E2E_TRANSPORT_ATTEMPTS = 3;

// Quarantine list. Entries name a journey step id plus the tracked reason.
// A quarantined step still runs and reports, but its failure becomes
// advisory (non-gating) until the triage owner clears it. The list starts
// empty: quarantine is a pressure valve for proven flakes, not a way to land
// red. Format: [{ step, reason, owner, since }].
export const E2E_QUARANTINE = [];

// Deterministic journey seed. Fixed calendar dates keep every assertion free
// of clock dependence; fixed entity names keep runs reproducible. Request and
// idempotency keys stay unique per attempt (UUID), but no assertion depends
// on their values.
export const E2E_SEED = Object.freeze({
  transactionDay: "2026-06-15",
  postedTime: Date.UTC(2026, 5, 15, 12, 0, 0) / 1000,
  rangeStart: "2026-01-01",
  rangeEnd: "2026-12-31",
  ownerName: "e2e-owner",
  guestName: "e2e-guest",
  secondName: "e2e-second",
  secondDisplay: "Second user",
  groupName: "E2E Household",
  accountId: "e2e-checking",
  accountName: "E2E checking",
});

// Step ids in run order. The orchestrator and the report share these names so
// quarantine entries, logs, and the final report stay aligned.
export const E2E_STEPS = Object.freeze([
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
]);

export function planSteps(selected = null) {
  if (selected === null) return [...E2E_STEPS];
  if (!E2E_STEPS.includes(selected)) throw new Error(`unknown step ${selected}: ${E2E_STEPS.join(", ")}`);
  const infrastructure = ["fixture", "images", "stack"];
  const boundary = infrastructure.indexOf(selected);
  if (boundary !== -1) return [...infrastructure.slice(0, boundary + 1), "teardown"];
  if (selected === "teardown") return ["teardown"];
  const needsIdentity = ["isolation", "direct-share", "group-feed", "receipts"].includes(selected);
  return [...infrastructure, ...(needsIdentity ? ["isolation"] : []),
    ...(selected === "isolation" ? [] : [selected]), "teardown"];
}

export function retainedImages(manifest, runId) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(runId) ||
      manifest?.runId !== runId || manifest.disposable !== E2E_DISPOSABLE_MARKER) {
    throw new Error("image set must belong to a retained disposable E2E run");
  }
  for (const name of ["api", "front", "auth"]) {
    if (!/^sha256:[a-f0-9]{64}$/.test(manifest[name])) throw new Error(`image set is missing the ${name} image ID`);
  }
  return [manifest.api, manifest.front, manifest.auth];
}

export function isQuarantined(step) {
  return E2E_QUARANTINE.some((entry) => entry.step === step);
}

// Teardown verification: every check names leftover Docker objects or
// processes scoped to one gate run id. The orchestrator runs them after
// `compose down` and fails the gate when any of them reports survivors — a
// gate that leaks containers, volumes, networks, or processes must not read
// green.
export function teardownChecks(runId) {
  const prefix = `nwe-e2e-${runId}`;
  return [
    {
      name: "containers",
      argv: ["docker", "ps", "-a", "--filter", `name=${prefix}`, "--format", "{{.Names}}"],
      expectEmpty: true,
    },
    {
      name: "volumes",
      argv: ["docker", "volume", "ls", "--filter", `name=${prefix}`, "--format", "{{.Name}}"],
      expectEmpty: true,
    },
    {
      name: "networks",
      argv: ["docker", "network", "ls", "--filter", `name=${prefix}`, "--format", "{{.Name}}"],
      expectEmpty: true,
    },
  ];
}

// Validate the disposable-fixture contract without touching the network.
// A malformed fixture fails fast before any container runs.
export function validateFixtureContract(fixture, { stateDir, issuer } = {}) {
  const problems = [];
  if (!fixture || typeof fixture !== "object") return ["fixture must be a JSON object"];
  if (fixture.testOnly !== true) problems.push("fixture.testOnly must be true (test-only credentials)");
  if (fixture.disposable !== E2E_DISPOSABLE_MARKER)
    problems.push(`fixture.disposable must be ${JSON.stringify(E2E_DISPOSABLE_MARKER)}`);
  if (stateDir && fixture.stateDir !== stateDir)
    problems.push("fixture.stateDir must be the disposable state directory");
  if (issuer && fixture.settings?.publicUrl !== issuer)
    problems.push("fixture.settings.publicUrl must be the disposable issuer");
  for (const key of ["subject", "guestSubject", "username"]) {
    if (typeof fixture[key] !== "string" || !fixture[key])
      problems.push(`fixture.${key} must be a non-empty string`);
  }
  if (fixture.subject === fixture.guestSubject)
    problems.push("owner and guest subjects must differ");
  return problems;
}
