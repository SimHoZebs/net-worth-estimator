#!/usr/bin/env node
// Report a deployment incident for the net-worth-estimator release pipeline.
//
// Exit 0 when the deployment needs an agent, 1 when healthy. The inverted
// convention is deliberate: this script is a schedule wake condition, and a
// wake fires on exit 0. Everything that prevents a check from running is
// reported so a broken watchdog wakes an agent instead of failing silently.
//
// An incident is one of:
//   - the Northflank release for the current main tip failed
//   - the Northflank release for the current main tip never concluded
//   - the frontend deploy for the current main tip failed
//   - readiness does not answer "ok" once the release window has closed
//
// Readiness is not evidence while a release is running. The workflow swaps the
// API for a maintenance container on purpose, so the endpoint answers
// "maintenance" or the ingress answers "no healthy upstream" for the length of
// the window and for a short boot after it closes. A release that has not
// started yet is also not an incident: the pipeline queues one per push, so a
// missing run means "not yet", not "failed". A release that stays open past the
// stuck threshold is the incident, and readiness is read again so the report
// carries the production state.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_PROJECT = "net-worth";
const DEFAULT_RELEASE_WORKFLOW = "waypoint-release";
const DEFAULT_FRONTEND_WORKFLOW = "vercel-release.yml";
const DEFAULT_READINESS_URL = "https://http--nwe-api--bc5m9smksgps.code.run/readyz";
const MAIN_REF = "refs/heads/main";
/** A release that just closed can still be booting the API. */
const BOOT_GRACE_MS = 3 * 60 * 1000;
/** A release that never concludes is itself the incident. */
const STUCK_AFTER_MS = 30 * 60 * 1000;
/** The scheduler caps a whole check at 30 seconds, so the check budgets itself. */
const CHECK_BUDGET_MS = 20_000;
const CALL_TIMEOUT_MS = 8_000;

const cli = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? CALL_TIMEOUT_MS,
  });

const readReadiness = async (url, options = {}) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(options.timeout ?? CALL_TIMEOUT_MS),
  });
  return (await response.text()).trim();
};

const failedStep = (run) => {
  for (const step of run?.spec?.spec?.steps ?? []) {
    const response = step.response ?? {};
    if (response.status && response.status !== "success" && response.status !== "skipped") {
      return { ref: step.ref, status: response.status, error: response.error ?? null };
    }
  }
  return null;
};

export async function assess({
  run = cli,
  read = readReadiness,
  now = Date.now,
  project = DEFAULT_PROJECT,
  releaseWorkflow = DEFAULT_RELEASE_WORKFLOW,
  frontendWorkflow = DEFAULT_FRONTEND_WORKFLOW,
  readinessUrl = DEFAULT_READINESS_URL,
} = {}) {
  const problems = [];
  const notes = [];
  const blind = [];
  const confirmed = new Set();
  const deadline = now() + CHECK_BUDGET_MS;
  const budget = () => Math.max(1_000, Math.min(CALL_TIMEOUT_MS, deadline - now()));
  const call = (command, args) => run(command, args, { timeout: budget() });
  let tip;
  let release;
  let short;

  try {
    const refs = call("git", ["ls-remote", "origin", MAIN_REF]);
    tip = refs.trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{40}$/.test(tip ?? "")) throw new Error(`unexpected main ref: ${refs.trim()}`);
    short = tip.slice(0, 12);
  } catch (error) {
    blind.push(`main tip: ${error.message}`);
  }

  if (tip) {
    try {
      const listed = JSON.parse(
        call("northflank", [
          "list", "workflow-runs",
          "--project", project,
          "--workflow", releaseWorkflow,
          "--output", "json",
        ]),
      );
      confirmed.add("release");
      const latest = (listed.runs ?? []).find((entry) => entry.name === `main-${short}`);
      if (!latest) {
        notes.push(`no ${releaseWorkflow} run for main-${short} yet`);
      } else if (!latest.concluded) {
        // A missing timestamp means age is unknown. Treat that as still in
        // flight rather than turning an absent field into a decades-old run.
        const started = Date.parse(latest.startedAt ?? latest.createdAt ?? "");
        const age = Number.isFinite(started) ? now() - started : 0;
        if (age > STUCK_AFTER_MS) {
          release = { state: "stuck", run: latest };
          problems.push({
            area: "release",
            summary: `Northflank release ${latest.name} never concluded`,
            detail: `run ${latest.id} started ${latest.startedAt ?? latest.createdAt ?? "at an unknown time"} and is still ${latest.status}`,
          });
        } else {
          release = { state: "in-flight", run: latest };
          notes.push(`${releaseWorkflow} ${latest.name} is still running (${latest.status})`);
        }
      } else if (latest.status === "failure") {
        release = { state: "failed", run: latest };
        let detail = "";
        try {
          const inspected = JSON.parse(
            call("northflank", [
              "get", "workflow-run",
              "--project", project,
              "--workflow", releaseWorkflow,
              "--run", latest.id,
              "--output", "json",
            ]),
          );
          const step = failedStep(inspected);
          if (step) {
            detail = ` step ${step.ref} reported ${step.status}`;
            if (step.error?.message) detail += `: ${step.error.message}`;
          }
        } catch (error) {
          detail = ` step detail unavailable: ${error.message}`;
        }
        problems.push({
          area: "release",
          summary: `Northflank release ${latest.name} failed`,
          detail: `run ${latest.id} concluded ${latest.concludedAt}${detail}`,
        });
      } else {
        release = { state: "complete", run: latest };
      }
    } catch (error) {
      blind.push(`release runs: ${error.message}`);
    }

    try {
      const listed = JSON.parse(
        call("gh", [
          "run", "list",
          "--commit", tip,
          "--workflow", frontendWorkflow,
          "--limit", "5",
          "--json", "databaseId,conclusion,status",
        ]),
      );
      confirmed.add("frontend");
      // Newest first. Only a real deploy outcome supersedes an earlier one; a
      // skipped or cancelled run proves nothing either way.
      const latest = listed.find(
        (entry) => entry.conclusion === "success" || entry.conclusion === "failure",
      );
      if (latest?.conclusion === "failure") {
        problems.push({
          area: "frontend",
          summary: "frontend deploy failed",
          detail: `run ${latest.databaseId} for main-${short}`,
        });
      }
    } catch (error) {
      blind.push(`frontend runs: ${error.message}`);
    }
  }

  // Readiness only means something once the release window has closed.
  const concluded = Date.parse(release?.run?.concludedAt ?? "");
  const expectedOpen =
    release?.state === "in-flight" ||
    (release?.state === "complete" &&
      Number.isFinite(concluded) &&
      now() - concluded < BOOT_GRACE_MS);

  if (expectedOpen) {
    notes.push("readiness not evaluated: the release window is open");
  } else {
    try {
      const body = await read(readinessUrl, { timeout: budget() });
      confirmed.add("readiness");
      if (body !== "ok") {
        problems.push({
          area: "readiness",
          summary: `readiness answered ${JSON.stringify(body)}`,
          detail: readinessUrl,
        });
      }
    } catch (error) {
      blind.push(`readiness: ${error.message}`);
    }
  }

  return { tip, problems, notes, blind, confirmed: confirmed.size };
}

export function needsAgent({ problems, blind, confirmed }) {
  if (problems.length > 0) return true;
  return blind.length > 0 && confirmed === 0;
}

export function report(result) {
  const { tip, problems, notes, blind } = result;
  const verdict = needsAgent(result) ? "DEPLOYMENT INCIDENT" : "DEPLOYMENT HEALTHY";
  const lines = [`${verdict}${tip ? ` at ${tip}` : ""}`];
  if (problems.length > 0) {
    lines.push("", "Problems:");
    for (const problem of problems) lines.push(`- [${problem.area}] ${problem.summary}`, `  ${problem.detail}`);
  }
  if (notes.length > 0) {
    lines.push("", "Notes:");
    for (const note of notes) lines.push(`- ${note}`);
  }
  if (blind.length > 0) {
    lines.push("", "Checks that could not run:");
    for (const entry of blind) lines.push(`- ${entry}`);
  }
  if (problems.length === 0 && blind.length === 0) lines.push("", "Healthy.");
  return lines.join("\n");
}

const main = async () => {
  const result = await assess();
  process.stdout.write(`${report(result)}\n`);
  process.exitCode = needsAgent(result) ? 0 : 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
