import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/images.yml", import.meta.url), "utf8");
const dockerfiles = {
  backend: readFileSync(new URL("../backend/Dockerfile", import.meta.url), "utf8"),
  frontend: readFileSync(new URL("../frontend/Dockerfile", import.meta.url), "utf8"),
  "backend-northflank": readFileSync(new URL("../backend/Dockerfile", import.meta.url), "utf8"),
  auth: readFileSync(new URL("../auth/better-auth/Dockerfile", import.meta.url), "utf8"),
};
const auth = dockerfiles.auth;

const imageTargets = {
  backend: "",
  frontend: "",
  "backend-northflank": "northflank",
  auth: "",
};

function reusePaths(component) {
  const match = workflow.match(new RegExp(`${component}\\)[\\s\\S]*?paths=\\(([^)]+)\\)`));
  assert.ok(match, `workflow must list reuse paths for ${component}`);
  return match[1].trim().split(/\s+/);
}

function contextCopySources(dockerfile, target = "") {
  // Join backslash continuations so multiline COPYs are covered.
  const logicalLines = dockerfile.split("\n").reduce((out, raw) => {
    const line = raw.replace(/\s+$/, "");
    if (out.length > 0 && out[out.length - 1].endsWith("\\")) {
      out[out.length - 1] = `${out[out.length - 1].slice(0, -1)} ${line.trim()}`;
    } else {
      out.push(line);
    }
    return out;
  }, []);
  const stages = [];
  for (const line of logicalLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("FROM ")) {
      const tokens = trimmed.slice(5).split(/\s+/);
      const aliasIndex = tokens.findIndex((token) => token.toUpperCase() === "AS");
      stages.push({
        name: aliasIndex >= 0 ? tokens[aliasIndex + 1] : `stage-${stages.length}`,
        base: tokens[0],
        copies: [],
      });
      continue;
    }
    if (!trimmed.startsWith("COPY ") || stages.length === 0) continue;
    const rest = trimmed.slice(5).trim();
    const tokens = rest.match(/"([^"]+)"|'([^']+)'|\S+/g) ?? [];
    const from = tokens.find((token) => token.startsWith("--from="))?.slice("--from=".length);
    const clean = tokens.filter((token) => !token.startsWith("--"));
    if (clean.length < 2) continue;
    stages.at(-1).copies.push({
      from,
      sources: clean.slice(0, -1).map((source) => source.replace(/^["']|["']$/g, "")),
    });
  }

  const selected = target ? stages.find((stage) => stage.name === target) : stages.at(-1);
  assert.ok(selected, `Dockerfile target must exist: ${target || "default"}`);
  const stagesByName = new Map(stages.map((stage) => [stage.name, stage]));
  const visited = new Set();
  const sources = new Set();
  const visit = (stage) => {
    if (visited.has(stage.name)) return;
    visited.add(stage.name);
    if (stagesByName.has(stage.base)) visit(stagesByName.get(stage.base));
    for (const copy of stage.copies) {
      if (!copy.from) for (const source of copy.sources) sources.add(source);
      else if (stagesByName.has(copy.from)) visit(stagesByName.get(copy.from));
    }
  };
  visit(selected);
  assert.ok(sources.size > 0, "Dockerfile target must have build-context COPY sources");
  return [...sources];
}

function covers(path, roots) {
  return roots.some(
    (root) => path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`),
  );
}

const changesInput = (roots, changed) => changed.some((path) => covers(path, roots));

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

test("build exclusions and Dockerfile inputs invalidate every image while unrelated Markdown can reuse", () => {
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /docker buildx imagetools inspect/);
  assert.match(workflow, /git diff --name-only/);
  assert.match(workflow, /docker buildx imagetools create --tag/);
  assert.match(workflow, /steps\.reuse\.outputs\.reuse != 'true'/);

  for (const [component, dockerfile] of Object.entries(dockerfiles)) {
    const paths = reusePaths(component);
    const dockerfilePath =
      component === "backend-northflank"
        ? "backend/Dockerfile"
        : component === "auth"
          ? "auth/better-auth/Dockerfile"
          : `${component}/Dockerfile`;
    assert.ok(
      paths.includes(".dockerignore"),
      `${component} reuse must include the shared build exclusions`,
    );
    assert.ok(covers(dockerfilePath, paths), `${component} reuse must include its Dockerfile`);
    assert.ok(
      changesInput(paths, [".dockerignore"]),
      `${component} must rebuild for .dockerignore`,
    );
    assert.equal(
      changesInput(paths, ["README.md"]),
      false,
      `${component} must reuse for unrelated Markdown`,
    );

    for (const source of contextCopySources(dockerfile, imageTargets[component])) {
      assert.ok(
        existsSync(new URL(`../${source}`, import.meta.url)),
        `Dockerfile COPY source must exist: ${source}`,
      );
      assert.ok(
        covers(source, paths),
        `workflow ${component} reuse paths must include Dockerfile COPY source: ${source} (got ${paths.join(" ")})`,
      );
    }
  }

  // Shared frontend recipes are copied individually so each file invalidates
  // identity reuse without pulling the whole frontend workspace into its inputs.
  const authPaths = reusePaths("auth");
  for (const source of contextCopySources(auth).filter((path) =>
    path.startsWith("frontend/src/components/"),
  )) {
    assert.ok(
      authPaths.includes(source),
      `shared component source must invalidate auth reuse explicitly: ${source}`,
    );
  }
});

test("publishes all four images and a production-only Bun identity runtime", () => {
  for (const image of ["backend", "frontend", "backend-northflank", "auth"]) {
    assert.match(workflow, new RegExp(`image: ${image}\\n`));
  }
  const identity = JSON.parse(
    readFileSync(new URL("../auth/better-auth/package.json", import.meta.url), "utf8"),
  );
  const frontend = JSON.parse(
    readFileSync(new URL("../frontend/package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    identity.dependencies["class-variance-authority"],
    frontend.dependencies["class-variance-authority"],
  );
  assert.match(
    auth,
    /bun install --frozen-lockfile --production --filter @waypoint\/auth --linker=hoisted \\\s+--omit=optional --omit=peer/,
  );
  assert.match(auth, /FROM oven\/bun:1\.4\.4-slim/);
  assert.match(auth, /COPY --from=build[^\n]*\/app\/auth\/better-auth\/src/);
  assert.match(auth, /COPY --from=build[^\n]*\/app\/auth\/better-auth\/public/);
  assert.match(auth, /COPY --from=build[^\n]*control-styles\.ts/);
  assert.match(auth, /COPY --from=build[^\n]*brand\.ts/);
  assert.doesNotMatch(auth, /COPY --from=build --chown=bun:bun \/app \/app/);
  assert.match(auth, /CMD \["bun", "run", "auth\/better-auth\/src\/server\.ts"\]/);
});

test("Northflank co-location is an explicit image target, not the default backend", () => {
  const backend = dockerfiles.backend;
  const release = readFileSync(
    new URL("../.github/workflows/northflank-release.yml", import.meta.url),
    "utf8",
  );
  assert.match(backend, /FROM python:3\.12-slim AS northflank/);
  assert.match(backend, /FROM standalone AS default\s*$/);
  assert.match(backend, /COPY --from=standalone[^\n]*\/app\/repair-claimed-posted-time/);
  assert.match(workflow, /image: backend-northflank[\s\S]*?target: northflank/);
  const paths = reusePaths("backend-northflank");
  assert.ok(paths.includes("ml"));
  assert.ok(paths.includes("deploy/northflank"));
  assert.match(release, /repository\}-backend-northflank:sha-/);
});
