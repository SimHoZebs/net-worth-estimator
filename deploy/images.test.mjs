import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/images.yml", import.meta.url), "utf8");
const auth = readFileSync(new URL("../auth/better-auth/Dockerfile", import.meta.url), "utf8");

test("publishes commit-addressed images only after a green main Tests run", () => {
  assert.match(workflow, /workflows: \["Tests"\]/);
  assert.match(workflow, /types: \[completed\]/);
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
  assert.match(workflow, /docker buildx imagetools inspect/);
  assert.match(workflow, /git diff --name-only/);
  assert.match(workflow, /docker buildx imagetools create --tag/);
  assert.match(workflow, /steps\.reuse\.outputs\.reuse != 'true'/);
  assert.match(
    workflow,
    /paths=\(backend deploy\/migrate\.sh deploy\/analysis-schema\.sql deploy\/api-boot\.sh\)/,
  );
  assert.match(workflow, /paths=\(frontend package\.json bun\.lock extension\/package\.json\)/);
  // Auth reuse paths derive from auth/better-auth/Dockerfile COPY sources.
  // Dockerfile is the single source; the workflow list must include every
  // COPY source from the build stage (excluding the final COPY --from
  // stage). This check parses the Dockerfile instead of repeating literals.
  // Join backslash continuations so multiline COPYs are covered.
  const logicalLines = auth.split("\n").reduce((out, raw) => {
    const line = raw.replace(/\s+$/, "");
    if (out.length > 0 && out[out.length - 1].endsWith("\\")) {
      out[out.length - 1] = `${out[out.length - 1].slice(0, -1)} ${line.trim()}`;
    } else {
      out.push(line);
    }
    return out;
  }, []);
  const copySources = [];
  for (const line of logicalLines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("COPY ")) continue;
    // Strip "COPY " and split. Handle JSON-array form by extracting quoted tokens.
    const rest = trimmed.slice(5).trim();
    const tokens = rest.match(/"([^"]+)"|'([^']+)'|\S+/g) ?? [];
    // Remove flags like --chown=... and --from=...
    const clean = tokens.filter((t) => !t.startsWith("--"));
    if (clean.length < 2) continue;
    // Last token is destination; all prior are sources. For --from stages,
    // sources are inside the build image, not the build context, so skip.
    if (rest.startsWith("--from=")) continue;
    for (const src of clean.slice(0, -1)) {
      // Normalize: strip quotes if any remain
      copySources.push(src.replace(/^["']|["']$/g, ""));
    }
  }
  assert.ok(copySources.length > 0, "Dockerfile must have COPY sources");
  // Extract the workflow auth paths array
  const authPathsMatch = workflow.match(/paths=\(auth\/better-auth[^)]+\)/);
  assert.ok(authPathsMatch, "workflow must list auth reuse paths");
  const authPathsLiteral = authPathsMatch[0];
  const authPathTokens = authPathsLiteral.slice(7, -1).split(" ");
  for (const src of copySources) {
    assert.ok(
      existsSync(new URL(`../${src}`, import.meta.url)),
      `Dockerfile COPY source must exist: ${src}`,
    );
    const covered = authPathTokens.some((token) => src === token || src.startsWith(`${token}/`));
    assert.ok(
      covered,
      `workflow auth reuse paths must include Dockerfile COPY source: ${src} (got ${authPathsLiteral})`,
    );
  }
  // frontend components copied individually in the Dockerfile must appear
  // as individual paths so a change to one file invalidates reuse.
  for (const src of copySources.filter((path) => path.startsWith("frontend/src/components/"))) {
    assert.ok(
      authPathTokens.includes(src),
      `shared component source must invalidate auth reuse explicitly: ${src}`,
    );
  }
});

test("publishes both app images and the Bun identity runtime", () => {
  for (const image of ["backend", "frontend", "auth"]) {
    assert.match(workflow, new RegExp(`image: ${image}\\n`));
  }
  assert.match(auth, /FROM oven\/bun:1\.4\.4-slim/);
  assert.match(auth, /CMD \["bun", "run", "auth\/better-auth\/src\/server.ts"\]/);
});

test("Northflank co-location is an explicit image target, not the default backend", () => {
  const backend = readFileSync(new URL("../backend/Dockerfile", import.meta.url), "utf8");
  const release = readFileSync(
    new URL("../.github/workflows/northflank-release.yml", import.meta.url),
    "utf8",
  );
  assert.match(backend, /FROM python:3\.12-slim AS northflank/);
  assert.match(backend, /FROM standalone AS default\s*$/);
  assert.match(workflow, /image: backend-northflank[\s\S]*?target: northflank/);
  assert.match(
    workflow,
    /paths=\(backend ml deploy\/northflank deploy\/migrate\.sh deploy\/analysis-schema\.sql deploy\/api-boot\.sh\)/,
  );
  assert.match(release, /repository\}-backend-northflank:sha-/);
});
