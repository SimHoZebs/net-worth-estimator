import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/images.yml", import.meta.url), "utf8");
const casdoor = readFileSync(new URL("../auth/casdoor/Dockerfile", import.meta.url), "utf8");

test("publishes commit-addressed images only from main with a job-scoped registry token", () => {
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /pull_request|secrets\.(?!GITHUB_TOKEN)/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /tags: .*:sha-\$\{\{ github.sha \}\}/);
  assert.match(workflow, /org.opencontainers.image.revision=\$\{\{ github.sha \}\}/);
  assert.doesNotMatch(workflow, /:latest\b/);
  for (const [, ref] of workflow.matchAll(/uses: (\S+)/g)) assert.match(ref, /@[a-f0-9]{40}$/);
});

test("publishes both app images and a mirror without changing the custom identity runtime", () => {
  for (const image of ["backend", "frontend", "casdoor-upstream"]) {
    assert.match(workflow, new RegExp(`image: ${image}\\n`));
  }
  assert.match(workflow, /target: upstream/);
  assert.match(casdoor, /FROM casbin\/casdoor:v4\.23\.0@sha256:[a-f0-9]{64} AS upstream\n\nFROM upstream AS runtime/);
  assert.match(casdoor, /ENTRYPOINT \["\/bin\/sh", "\/casdoor-template\/entrypoint.sh"\]/);
});
