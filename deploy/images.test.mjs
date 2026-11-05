import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/images.yml", import.meta.url), "utf8");
const casdoor = readFileSync(new URL("../auth/casdoor/Dockerfile", import.meta.url), "utf8");

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
  assert.match(workflow, /paths=\(auth\/casdoor\)/);
});

test("publishes both app images, the identity runtime, and the upstream mirror", () => {
  for (const image of ["backend", "frontend", "casdoor", "casdoor-upstream"]) {
    assert.match(workflow, new RegExp(`image: ${image}\\n`));
  }
  assert.match(workflow, /target: upstream/);
  assert.match(casdoor, /FROM casbin\/casdoor:v4\.23\.0@sha256:[a-f0-9]{64} AS upstream\n\nFROM upstream AS runtime/);
  assert.match(casdoor, /ENTRYPOINT \["\/bin\/sh", "\/casdoor-template\/entrypoint.sh"\]/);
});
