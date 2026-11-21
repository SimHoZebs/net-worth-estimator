#!/usr/bin/env node
// Verifies that a release targets a commit that passed the Tests gates.
// Shared by the Northflank and Vercel release workflows so a fix to the SHA
// check, the green-main-run requirement, or the dispatch-ref rule applies to
// both gates. Reads its entire context from the caller's env.
const sha = process.env.RELEASE_SHA;
if (!/^[a-f0-9]{40}$/.test(sha || "")) throw new Error("A full release SHA is required");

if (process.env.EVENT_NAME === "workflow_run") {
  if (process.env.TESTS_CONCLUSION !== "success" ||
      process.env.TESTS_EVENT !== "push" ||
      process.env.TESTS_BRANCH !== "main") {
    throw new Error("The Tests workflow run is not a green push to main");
  }
} else if (process.env.EVENT_NAME === "workflow_dispatch") {
  if (process.env.DISPATCH_REF !== "refs/heads/main") throw new Error("Manual dispatch only releases main");
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const query = new URLSearchParams({ head_sha: sha, status: "completed", per_page: "100" });
  const response = await fetch(`${api}/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/tests.yml/runs?${query}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`Cannot read Tests runs (HTTP ${response.status})`);
  const runs = (await response.json()).workflow_runs ?? [];
  const green = runs.some((run) =>
    run.conclusion === "success" && run.event === "push" && run.head_branch === "main");
  if (!green) throw new Error(`No successful main Tests run for ${sha}`);
} else {
  throw new Error("Unsupported release event");
}
console.log(`Tests passed for ${sha}.`);
