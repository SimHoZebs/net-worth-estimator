import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { codeRanInTestsRun, isDocPath, isDocsOnly } from "./ci-code-gate.mjs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const classifier = new URL("./ci-code-gate.mjs", import.meta.url).pathname;
const testsWorkflow = read("../.github/workflows/tests.yml");
const releaseWorkflows = [
  "../.github/workflows/images.yml",
  "../.github/workflows/northflank-release.yml",
  "../.github/workflows/vercel-release.yml",
].map(read);

function classify(input) {
  const result = spawnSync(process.execPath, [classifier], { input, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function jobBlock(workflow, id) {
  const match = workflow.match(
    new RegExp(`^  ${id}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|(?![\\s\\S]))`, "m"),
  );
  assert.ok(match, `job ${id} missing`);
  return match[1];
}

function stepsOf(block) {
  const lines = block.split("\n");
  const starts = lines.flatMap((line, index) => (/^      - /.test(line) ? [index] : []));
  return starts.map((start, index) =>
    lines.slice(start, starts[index + 1] ?? lines.length).join("\n"),
  );
}

function gateStep() {
  const step = stepsOf(jobBlock(testsWorkflow, "integration")).find((candidate) =>
    candidate.includes("name: Gate this shard"),
  );
  assert.ok(step, "shard gate step missing");
  return step;
}

function runShardGate(env) {
  const step = gateStep();
  const lines = step.split("\n");
  const start = lines.findIndex((line) => line === "        run: |");
  assert.ok(start >= 0, "shard gate has no inline shell");
  const shell = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("          ")) shell.push(line.slice(10));
    else if (line.trim() === "") shell.push("");
    else break;
  }

  const dir = mkdtempSync(join(tmpdir(), "nwe-shard-gate-"));
  try {
    const output = join(dir, "output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", shell.join("\n")], {
      encoding: "utf8",
      env: {
        ...process.env,
        RESULT: "success",
        CODE: "false",
        EVENT_NAME: "push",
        FORK: "false",
        GITHUB_OUTPUT: output,
        ...env,
      },
    });
    return { ...result, outputText: readFileSync(output, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("documentation is prose plus diagram assets under docs only", () => {
  const docsOnly = [
    "README.md",
    "AGENTS.md",
    "docs/release-gates.md",
    "audit-findings/001-muted-token.md",
    "docs/diagrams/architecture-overview.mmd",
    "docs/diagrams/architecture-overview.svg",
    "docs/primitives.html",
    "docs/diagrams/index.html",
    "docs/a b.md",
    "docs/a\nb.md",
  ];
  for (const path of docsOnly) assert.equal(isDocPath(path), true, path);

  const executable = [
    "",
    "docs/diagrams/build-page.ts",
    "docs/diagrams/server.ts",
    ".github/workflows/tests.yml",
    "scripts/ci-code-gate.mjs",
    "frontend/index.html",
    "extension/panel.html",
    "frontend/public/favicon.svg",
    "backend/internal/receipts/adapters/mock/testdata/market.png",
    "vercel.mjs",
    "README.md.bak",
  ];
  for (const path of executable) assert.equal(isDocPath(path), false, path);

  assert.equal(isDocsOnly([]), false);
  assert.equal(isDocsOnly([""]), false);
  assert.equal(isDocsOnly(["README.md", "docs/diagrams/data-ingestion.svg"]), true);
  assert.equal(isDocsOnly(["docs/diagrams/index.html", "docs/diagrams/build-page.ts"]), false);
});

test("classifier consumes NUL-delimited names without trimming", () => {
  assert.equal(classify("README.md\0docs/diagrams/data-ingestion.svg\0"), "false\n");
  assert.equal(classify("docs/a b.md\0docs/a\nb.md\0"), "false\n");
  assert.equal(classify("docs/diagrams/build-page.ts\0"), "true\n");
  assert.equal(classify("README.md\0backend/main.go\0"), "true\n");
  assert.equal(classify(""), "true\n");
});

test("Tests keeps every required check and reports all four shard names", () => {
  // Branch protection requires these exact job names. A path-filtered
  // workflow would leave them pending, so the workflow always runs and the
  // jobs skip by conditional instead.
  const required = [
    "Backend tests",
    "Frontend and static gates",
    "Extension browser tests",
    "Integration tests (shard ${{ matrix.shard }}/4)",
  ];
  const jobNames = [...testsWorkflow.matchAll(/^    name: (.+)$/gm)].map((match) => match[1]);
  for (const name of required) assert.ok(jobNames.includes(name), `missing ${name}`);
  assert.match(testsWorkflow, /shard: \[1, 2, 3, 4\]/);

  assert.doesNotMatch(testsWorkflow, /^\s+paths(?:-ignore)?:/m);
  assert.match(testsWorkflow, /^  workflow_dispatch:$/m);
  assert.match(testsWorkflow, /bash scripts\/ci-changed-paths\.sh/);
  assert.match(testsWorkflow, /DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}/);

  // Four single jobs skip by job-level conditional. The matrix job stays
  // eligible with if: always() and gates each step so the shard names expand.
  assert.equal((testsWorkflow.match(/^    needs: changes$/gm) ?? []).length, 5);
  assert.equal(
    (testsWorkflow.match(/needs\.changes\.outputs\.code == 'true'/g) ?? []).length,
    4,
  );
  assert.match(testsWorkflow, /name: Integration tests \(shard \$\{\{ matrix\.shard \}\}\/4\)\n    needs: changes\n[\s\S]*?    if: always\(\)/);

  // Every shard step except the gate itself is covered structurally, so
  // adding or renaming a step cannot silently drop its condition.
  const steps = stepsOf(jobBlock(testsWorkflow, "integration"));
  assert.ok(steps.length > 1);
  assert.equal(steps.filter((step) => step.includes("name: Gate this shard")).length, 1);
  for (const step of steps) {
    if (step.includes("name: Gate this shard")) continue;
    assert.match(step, /if: steps\.gate\.outputs\.run == 'true'/, `ungated step: ${step.slice(0, 80)}`);
  }
  const upload = steps.find((step) => step.includes("name: Upload failure artifacts"));
  assert.ok(upload);
  assert.match(upload, /if: steps\.gate\.outputs\.run == 'true' && failure\(\)/);
});

test("shard gate fails closed on failed classification or invalid output", () => {
  const gate = gateStep();
  assert.match(gate, /RESULT: \$\{\{ needs\.changes\.result \}\}/);
  assert.match(gate, /Classification did not succeed/);
  assert.match(gate, /Invalid classification output/);

  const code = runShardGate({ CODE: "true" });
  assert.equal(code.status, 0, code.stderr);
  assert.match(code.outputText, /^run=true$/m);

  const docs = runShardGate({ CODE: "false" });
  assert.equal(docs.status, 0, docs.stderr);
  assert.match(docs.outputText, /^run=false$/m);

  for (const [result, codeValue] of [
    ["failure", ""],
    ["cancelled", ""],
    ["skipped", "false"],
  ]) {
    const failed = runShardGate({ RESULT: result, CODE: codeValue });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, new RegExp(`Classification did not succeed: ${result}`));
    assert.doesNotMatch(failed.outputText, /run=/);
  }

  for (const codeValue of ["", "yes", "TRUE"]) {
    const invalid = runShardGate({ CODE: codeValue });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /Invalid classification output/);
    assert.doesNotMatch(invalid.outputText, /run=/);
  }

  // Fork semantics stay intact for pull requests.
  const fork = runShardGate({ EVENT_NAME: "pull_request", FORK: "true", CODE: "true" });
  assert.equal(fork.status, 0, fork.stderr);
  assert.match(fork.outputText, /^run=true$/m);
  const sameRepo = runShardGate({ EVENT_NAME: "pull_request", FORK: "false", CODE: "true" });
  assert.equal(sameRepo.status, 0, sameRepo.stderr);
  assert.match(sameRepo.outputText, /^run=false$/m);
});

test("release workflows watch Tests and skip docs-only runs but keep dispatch", () => {
  for (const [index, workflow] of releaseWorkflows.entries()) {
    assert.match(workflow, /workflows: \["Tests"\]/, `workflow ${index}`);
    assert.doesNotMatch(workflow, /workflows: \["Publish container images"\]/, `workflow ${index}`);
    assert.match(workflow, /^  workflow_dispatch:$/m, `workflow ${index}`);
    assert.match(workflow, /^  code-guard:$/m, `workflow ${index}`);
    assert.match(workflow, /TESTS_RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/, `workflow ${index}`);
    assert.match(workflow, /node scripts\/ci-code-gate\.mjs --tests-run "\$TESTS_RUN_ID"/, `workflow ${index}`);
    assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/, `workflow ${index}`);
    assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/, `workflow ${index}`);
    assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/, `workflow ${index}`);
    // Guard runners must not start for ineligible workflow_run events.
    const guard = workflow.match(/^  code-guard:\n([\s\S]*?)^  \w[\w-]+:/m)?.[1] ?? "";
    assert.match(guard, /^    if: >-\n/m, `workflow ${index}`);
    assert.equal((workflow.match(/^    needs: code-guard$/gm) ?? []).length, 1, `workflow ${index}`);
    assert.equal(
      (workflow.match(/needs\.code-guard\.outputs\.code == 'true'/g) ?? []).length,
      1,
      `workflow ${index}`,
    );
    assert.match(workflow, /github\.event_name == 'workflow_dispatch'/, `workflow ${index}`);
  }
  for (const workflow of releaseWorkflows) {
    assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'\)\)/);
  }
});

test("Tests-run guard reads the gate conclusion through the API", async () => {
  const env = {
    GITHUB_API_URL: "https://api.github.test",
    GITHUB_REPOSITORY: "SimHoZebs/net-worth-estimator",
    GH_TOKEN: "token",
  };
  const stub = (conclusion, name = "Tests") => async (url, options) => {
    assert.match(url, /^https:\/\/api\.github\.test\/repos\/SimHoZebs\/net-worth-estimator\/actions\/runs\/42/);
    assert.equal(options.headers.Authorization, "Bearer token");
    if (url.endsWith("/jobs?per_page=100")) {
      return {
        ok: true,
        json: async () => ({
          jobs: [
            { name: "Classify changed paths", conclusion: "success" },
            { name: "Frontend and static gates", conclusion },
          ],
        }),
      };
    }
    return { ok: true, json: async () => ({ name }) };
  };

  assert.equal(await codeRanInTestsRun("42", env, stub("skipped")), false);
  assert.equal(await codeRanInTestsRun("42", env, stub("success")), true);
  assert.equal(await codeRanInTestsRun("42", env, stub("failure")), true);
  await assert.rejects(
    codeRanInTestsRun("42", env, stub("success", "Publish container images")),
    /Expected a Tests run, got Publish container images/,
  );
  await assert.rejects(codeRanInTestsRun("42", env, async () => ({ ok: false, status: 403 })), /HTTP 403/);
  await assert.rejects(
    codeRanInTestsRun("42", env, async (url) => ({
      ok: true,
      json: async () => (url.endsWith("/jobs?per_page=100") ? { jobs: [] } : { name: "Tests" }),
    })),
    /no Frontend and static gates job/,
  );
});
