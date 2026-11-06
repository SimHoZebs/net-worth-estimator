import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/images.yml", import.meta.url), "utf8");
const auth = readFileSync(new URL("../auth/better-auth/Dockerfile", import.meta.url), "utf8");

test("publishes commit-addressed images only after a green main Tests run", () => {
  assert.match(workflow, /workflows: \["Tests"\]/);
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.doesNotMatch(workflow, /pull_request|secrets\.(?!GITHUB_TOKEN)/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /sha-\$\{\{ github\.event_name == 'workflow_run'/);
  assert.match(workflow, /head_sha \|\| github\.sha/);
  assert.doesNotMatch(workflow, /:latest\b/);
  for (const [, ref] of workflow.matchAll(/uses: (\S+)/g)) assert.match(ref, /@[a-f0-9]{40}$/);
});

test("reuses the last immutable image when a component did not change", () => {
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /git rev-list --max-count=20/);
  assert.match(workflow, /docker buildx imagetools inspect/);
  assert.match(workflow, /git diff --name-only/);
  assert.match(workflow, /docker buildx imagetools create --tag/);
  assert.match(workflow, /steps\.reuse\.outputs\.reuse != 'true'/);
  assert.match(workflow, /paths=\(backend deploy\/migrate\.sh deploy\/analysis-schema\.sql\)/);
  assert.match(workflow, /paths=\(frontend package\.json bun\.lock extension\/package\.json\)/);
  assert.match(workflow, /paths=\(auth\/better-auth package\.json bun\.lock frontend\/package\.json extension\/package\.json\)/);
});

test("publishes both app images and the Bun identity runtime", () => {
  for (const image of ["backend", "frontend", "auth"]) {
    assert.match(workflow, new RegExp(`image: ${image}\\n`));
  }
  assert.match(auth, /FROM oven\/bun:1\.4\.4-slim/);
  assert.match(auth, /CMD \["bun", "run", "auth\/better-auth\/src\/server.ts"\]/);
});
