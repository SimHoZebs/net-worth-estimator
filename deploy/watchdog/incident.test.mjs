import assert from "node:assert/strict";
import test from "node:test";

import { assess, needsAgent, report } from "./incident.mjs";

const TIP = "987e006855014eee50ae9e3424a26d530104d5e5";
const SHORT = TIP.slice(0, 12);

// Older than the boot grace, so readiness counts as evidence.
const CONCLUDED = "2026-11-10T22:53:38.180Z";
const AFTER_GRACE = Date.parse(CONCLUDED) + 10 * 60 * 1000;

const releaseRun = (overrides = {}) => ({
  id: "run-1",
  name: `main-${SHORT}`,
  status: "success",
  concluded: true,
  startedAt: CONCLUDED,
  concludedAt: CONCLUDED,
  ...overrides,
});

const failedDetail = {
  spec: { spec: { steps: [
    { ref: "identity-backup", response: { status: "success" } },
    { ref: "migrate", response: { status: "failure", error: { code: 404, message: "No running container found" } } },
    { ref: "start-api", response: {} },
  ] } },
};

const fakeRun = ({ runs = [], detail = failedDetail, frontend = [] } = {}) => (command, args) => {
  if (command === "git") return `${TIP}\trefs/heads/main\n`;
  if (command === "northflank" && args[0] === "list") return JSON.stringify({ runs });
  if (command === "northflank" && args[0] === "get") return JSON.stringify(detail);
  if (command === "gh") return JSON.stringify(frontend);
  throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
};

const healthyRead = async () => "ok";

test("a green release with ok readiness is not an incident", async () => {
  const result = await assess({
    run: fakeRun({ runs: [releaseRun()] }),
    read: healthyRead,
    now: () => AFTER_GRACE,
  });
  assert.equal(result.problems.length, 0);
  assert.equal(result.blind.length, 0);
  assert.equal(needsAgent(result), false);
  assert.match(report(result), /Healthy\./);
  assert.match(report(result), /DEPLOYMENT HEALTHY/);
});

test("a failed release reports the failing step and its error", async () => {
  const result = await assess({
    run: fakeRun({ runs: [releaseRun({ status: "failure" })] }),
    read: healthyRead,
    now: () => AFTER_GRACE,
  });
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].area, "release");
  assert.match(result.problems[0].detail, /migrate reported failure: No running container found/);
  assert.equal(needsAgent(result), true);
  assert.match(report(result), /DEPLOYMENT INCIDENT/);
});

test("a release for an older commit is ignored, because a newer tip supersedes it", async () => {
  const stale = releaseRun({ name: "main-199fb167a6d4", status: "failure" });
  const result = await assess({
    run: fakeRun({ runs: [stale] }),
    read: healthyRead,
    now: () => AFTER_GRACE,
  });
  assert.equal(result.problems.length, 0);
  assert.match(result.notes.join("\n"), new RegExp(`no waypoint-release run for main-${SHORT} yet`));
  assert.equal(needsAgent(result), false);
});

test("readiness is not evidence while an earlier tip's release is still in flight", async () => {
  const prior = releaseRun({
    name: "main-199fb167a6d4",
    status: "async_wait",
    concluded: false,
    concludedAt: null,
    startedAt: "2026-11-11T02:35:00.000Z",
    createdAt: "2026-11-11T02:34:58.000Z",
  });
  const result = await assess({
    run: fakeRun({ runs: [prior] }),
    read: async () => "maintenance",
    now: () => Date.parse(prior.startedAt) + 2 * 60 * 1000,
  });
  assert.equal(result.problems.length, 0);
  assert.match(result.notes.join("\n"), new RegExp(`no waypoint-release run for main-${SHORT} yet`));
  assert.match(result.notes.join("\n"), /release window is open/);
  assert.equal(needsAgent(result), false);
});

test("readiness waits for the boot grace of an earlier tip's release", async () => {
  const prior = releaseRun({
    name: "main-199fb167a6d4",
    concludedAt: "2026-11-11T02:30:53.587Z",
  });
  const result = await assess({
    run: fakeRun({ runs: [prior] }),
    read: async () => "no healthy upstream",
    now: () => Date.parse(prior.concludedAt) + 30_000,
  });
  assert.equal(result.problems.length, 0);
  assert.match(result.notes.join("\n"), /release window is open/);
  assert.equal(needsAgent(result), false);
});

test("an earlier tip's release past the stuck threshold is still an incident", async () => {
  const prior = releaseRun({
    name: "main-199fb167a6d4",
    status: "waiting",
    concluded: false,
    concludedAt: null,
  });
  const result = await assess({
    run: fakeRun({ runs: [prior] }),
    read: async () => "maintenance",
    now: () => Date.parse(CONCLUDED) + 45 * 60 * 1000,
  });
  assert.equal(result.problems.length, 2);
  assert.match(result.problems[0].summary, /main-199fb167a6d4 never concluded/);
  assert.equal(result.problems[1].area, "readiness");
  assert.equal(needsAgent(result), true);
});

test("an older stuck release is reported even when a younger run is queued", async () => {
  const stuck = releaseRun({
    id: "run-old",
    name: "main-199fb167a6d4",
    status: "waiting",
    concluded: false,
    concludedAt: null,
    startedAt: "2026-11-11T01:00:00.000Z",
    createdAt: "2026-11-11T01:00:00.000Z",
  });
  const queued = releaseRun({
    id: "run-new",
    status: "waiting",
    concluded: false,
    concludedAt: null,
    startedAt: "2026-11-11T02:59:00.000Z",
    createdAt: "2026-11-11T02:59:00.000Z",
  });
  const result = await assess({
    run: fakeRun({ runs: [queued, stuck] }),
    read: async () => "maintenance",
    now: () => Date.parse("2026-11-11T03:00:00.000Z"),
  });
  assert.equal(result.problems[0].area, "release");
  assert.match(result.problems[0].summary, /main-199fb167a6d4 never concluded/);
  assert.equal(result.problems[1].area, "readiness");
  assert.equal(needsAgent(result), true);
});

test("a failed earlier release does not get the boot grace", async () => {
  const prior = releaseRun({ name: "main-199fb167a6d4", status: "failure" });
  const result = await assess({
    run: fakeRun({ runs: [prior] }),
    read: async () => "maintenance",
    now: () => Date.parse(prior.concludedAt) + 30_000,
  });
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].area, "readiness");
  assert.equal(needsAgent(result), true);
});

test("readiness counts after an earlier tip's release closes past the grace", async () => {
  const prior = releaseRun({ name: "main-199fb167a6d4" });
  const result = await assess({
    run: fakeRun({ runs: [prior] }),
    read: async () => "maintenance",
    now: () => Date.parse(prior.concludedAt) + 10 * 60 * 1000,
  });
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].area, "readiness");
  assert.equal(needsAgent(result), true);
});

test("a concluded run without start timestamps does not hide the boot grace", async () => {
  const recent = releaseRun({
    id: "run-recent",
    name: "main-199fb167a6d4",
    concludedAt: "2026-11-11T02:30:53.587Z",
  });
  const undated = releaseRun({
    id: "run-undated",
    name: "main-199fb167a6d5",
    startedAt: null,
    createdAt: null,
    concludedAt: "2026-11-11T01:00:00.000Z",
  });
  const result = await assess({
    run: fakeRun({ runs: [undated, recent] }),
    read: async () => "maintenance",
    now: () => Date.parse(recent.concludedAt) + 30_000,
  });
  assert.equal(result.problems.length, 0);
  assert.match(result.notes.join("\n"), /release window is open/);
  assert.equal(needsAgent(result), false);
});

test("the boot grace follows the most recently concluded run", async () => {
  const older = releaseRun({
    id: "run-older",
    name: "main-199fb167a6d4",
    concludedAt: "2026-11-11T01:00:00.000Z",
  });
  const newer = releaseRun({
    id: "run-newer",
    name: "main-199fb167a6d5",
    concludedAt: "2026-11-11T02:30:53.587Z",
  });
  const result = await assess({
    run: fakeRun({ runs: [older, newer] }),
    read: async () => "maintenance",
    now: () => Date.parse(newer.concludedAt) + 30_000,
  });
  assert.equal(result.problems.length, 0);
  assert.match(result.notes.join("\n"), /release window is open/);
  assert.equal(needsAgent(result), false);
});

test("readiness answering maintenance after the window closes is an incident", async () => {
  const result = await assess({
    run: fakeRun({ runs: [releaseRun()] }),
    read: async () => "maintenance",
    now: () => AFTER_GRACE,
  });
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].area, "readiness");
  assert.match(result.problems[0].summary, /maintenance/);
  assert.equal(needsAgent(result), true);
});

test("readiness is not evidence while the release window is open", async () => {
  const result = await assess({
    run: fakeRun({ runs: [releaseRun({ status: "async_wait", concluded: false, concludedAt: null })] }),
    read: async () => "no healthy upstream",
    now: () => AFTER_GRACE,
  });
  assert.equal(result.problems.length, 0);
  assert.match(result.notes.join("\n"), /still running/);
  assert.match(result.notes.join("\n"), /release window is open/);
  assert.equal(needsAgent(result), false);
});

test("readiness is not evidence during the boot grace after a release closes", async () => {
  const concludedAt = "2026-11-11T02:30:53.587Z";
  const result = await assess({
    run: fakeRun({ runs: [releaseRun({ concludedAt })] }),
    read: async () => "no healthy upstream",
    now: () => Date.parse(concludedAt) + 30_000,
  });
  assert.equal(result.problems.length, 0);
  assert.match(result.notes.join("\n"), /release window is open/);
  assert.equal(needsAgent(result), false);
});

test("a release that never concludes becomes an incident past the stuck threshold", async () => {
  const result = await assess({
    run: fakeRun({ runs: [releaseRun({ status: "waiting", concluded: false, concludedAt: null })] }),
    read: async () => "maintenance",
    now: () => Date.parse(CONCLUDED) + 45 * 60 * 1000,
  });
  assert.equal(result.problems.length, 2);
  assert.equal(result.problems[0].area, "release");
  assert.match(result.problems[0].summary, /never concluded/);
  assert.equal(result.problems[1].area, "readiness");
  assert.equal(needsAgent(result), true);
});

test("an in-flight release with no timestamp is not reported as stuck", async () => {
  const result = await assess({
    run: fakeRun({ runs: [releaseRun({ status: "waiting", concluded: false, concludedAt: null, startedAt: null })] }),
    read: async () => "maintenance",
    now: () => Date.parse(CONCLUDED) + 365 * 24 * 60 * 60 * 1000,
  });
  assert.equal(result.problems.length, 0);
  assert.match(result.notes.join("\n"), /still running/);
  assert.equal(needsAgent(result), false);
});

test("a failed frontend deploy is an incident", async () => {
  const result = await assess({
    run: fakeRun({ runs: [releaseRun()], frontend: [{ databaseId: 42, conclusion: "failure", status: "completed" }] }),
    read: healthyRead,
    now: () => AFTER_GRACE,
  });
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].area, "frontend");
  assert.match(result.problems[0].detail, /run 42/);
  assert.equal(needsAgent(result), true);
});

test("a frontend rerun supersedes an earlier failure for the same tip", async () => {
  const result = await assess({
    run: fakeRun({
      runs: [releaseRun()],
      frontend: [
        { databaseId: 43, conclusion: "success", status: "completed" },
        { databaseId: 42, conclusion: "failure", status: "completed" },
      ],
    }),
    read: healthyRead,
    now: () => AFTER_GRACE,
  });
  assert.equal(result.problems.length, 0);
  assert.equal(needsAgent(result), false);
});

test("a skipped rerun does not hide an earlier frontend failure", async () => {
  const result = await assess({
    run: fakeRun({
      runs: [releaseRun()],
      frontend: [
        { databaseId: 44, conclusion: "skipped", status: "completed" },
        { databaseId: 42, conclusion: "failure", status: "completed" },
      ],
    }),
    read: healthyRead,
    now: () => AFTER_GRACE,
  });
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].area, "frontend");
  assert.match(result.problems[0].detail, /run 42/);
  assert.equal(needsAgent(result), true);
});

test("a broken watchdog wakes an agent instead of failing silently", async () => {
  const blind = () => {
    throw new Error("command not found");
  };
  const result = await assess({
    run: blind,
    read: async () => {
      throw new Error("fetch failed");
    },
    now: () => AFTER_GRACE,
  });
  assert.equal(result.problems.length, 0);
  assert.equal(result.blind.length, 2);
  assert.equal(result.confirmed, 0);
  assert.equal(needsAgent(result), true);
  assert.match(report(result), /Checks that could not run/);
});

test("blind release checks are not an incident while readiness is confirmed ok", async () => {
  const result = await assess({
    run: (command) => {
      if (command === "git") return `${TIP}\trefs/heads/main\n`;
      throw new Error("expired token");
    },
    read: healthyRead,
    now: () => AFTER_GRACE,
  });
  assert.equal(result.problems.length, 0);
  assert.equal(result.blind.length, 2);
  assert.equal(result.confirmed, 1);
  assert.equal(needsAgent(result), false);
});
