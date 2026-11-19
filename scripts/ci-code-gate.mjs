#!/usr/bin/env node
// Decides whether a trigger needs the executable-code gates.
//
// Documentation is Markdown anywhere in the tree plus the diagram sources,
// rendered assets, and static HTML under docs/. Executable files that live
// beside documentation, such as docs/diagrams/build-page.ts, are code. Workflow
// definitions, scripts, configuration, and test data are code even when they
// sit next to Markdown.
//
// CLI modes:
//   (none)              read NUL-delimited paths from stdin (git diff -z)
//   --tests-run <id>    inspect a completed Tests run through the GitHub API
//
// Both modes print true when code gates are needed and false for docs-only
// changes. An empty path list means code so a failed diff never skips gates.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const TESTS_WORKFLOW_NAME = "Tests";
export const GATE_JOB_NAME = "Frontend and static gates";

export function isDocPath(path) {
  if (path.endsWith(".md")) return true;
  return (
    path.startsWith("docs/") &&
    (path.endsWith(".mmd") || path.endsWith(".svg") || path.endsWith(".html"))
  );
}

export function isDocsOnly(paths) {
  // git diff -z terminates every path with NUL; the trailing empty field is
  // not a path. Names are used verbatim so whitespace in a filename is kept.
  const changed = paths.filter((path) => path.length > 0);
  if (changed.length === 0) return false;
  return changed.every(isDocPath);
}

export async function codeRanInTestsRun(runId, env, fetchImpl = fetch) {
  if (!/^\d+$/.test(String(runId))) throw new Error("A Tests run id is required");
  const api = env.GITHUB_API_URL ?? "https://api.github.com";
  const headers = {
    Authorization: `Bearer ${env.GH_TOKEN}`,
    Accept: "application/vnd.github+json",
  };
  const runResponse = await fetchImpl(`${api}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${runId}`, {
    headers,
  });
  if (!runResponse.ok) throw new Error(`Cannot read the workflow run (HTTP ${runResponse.status})`);
  const run = await runResponse.json();
  if (run.name !== TESTS_WORKFLOW_NAME) {
    throw new Error(`Expected a ${TESTS_WORKFLOW_NAME} run, got ${run.name}`);
  }

  const response = await fetchImpl(
    `${api}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${runId}/jobs?per_page=100`,
    { headers },
  );
  if (!response.ok) throw new Error(`Cannot read Tests jobs (HTTP ${response.status})`);
  const jobs = (await response.json()).jobs ?? [];
  const gate = jobs.find((job) => job.name === GATE_JOB_NAME);
  if (!gate) throw new Error(`The Tests run has no ${GATE_JOB_NAME} job`);
  // A job skipped by a conditional reports "skipped". Branch protection reads
  // that as success, so the job conclusion is the reliable docs-only signal.
  return gate.conclusion !== "skipped";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, value] = process.argv.slice(2);
  let code;
  if (mode === "--tests-run") {
    code = await codeRanInTestsRun(value, process.env);
  } else if (!mode) {
    code = !isDocsOnly(readFileSync(0).toString("utf8").split("\0"));
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
  process.stdout.write(`${code}\n`);
}
