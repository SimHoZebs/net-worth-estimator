import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { vercelConfig } from "./vercel.mjs";

const settings = {
  BACKEND_URL: "https://api.example.test/",
  NET_WORTH_ESTIMATOR_PUBLIC_URL: "https://app.example.test/",
  NET_WORTH_ESTIMATOR_PROXY_SECRET: "0123456789abcdef0123456789abcdef",
};

test("Vercel proxies the API, callbacks, probes, and streams before static fallback", () => {
  const config = vercelConfig(settings);
  const [proxy, filesystem, fallback] = config.routes;
  const pattern = new RegExp(`^${proxy.src}$`);
  for (const path of ["/v1", "/v1/auth/login", "/v1/auth/callback", "/v1/auth/backchannel-logout", "/v1/projections/stochastic", "/healthz", "/readyz"]) {
    assert.equal(path.replace(pattern, proxy.dest), `https://api.example.test${path}`);
  }
  for (const path of ["/", "/assets/app.js", "/settings", "/v10", "/readyz/unexpected"])
    assert.equal(pattern.test(path), false);
  assert.deepEqual(filesystem, { handle: "filesystem" });
  assert.deepEqual(fallback, { src: "/(.*)", dest: "/404.html", status: 404 });
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, "frontend/dist");
  assert.equal(proxy.headers["Cache-Control"], "no-store");
  assert.deepEqual(proxy.has, [{ type: "host", value: { eq: "app.example.test" } }]);
});

test("the edge replaces client ingress headers without embedding the secret", () => {
  const config = vercelConfig(settings);
  const transforms = config.routes[0].transforms;
  assert.deepEqual(transforms, [
    {
      type: "request.headers", op: "set", target: { key: "Waypoint-Proxy-Secret" },
      args: "$NET_WORTH_ESTIMATOR_PROXY_SECRET", env: ["NET_WORTH_ESTIMATOR_PROXY_SECRET"],
    },
    {
      type: "request.headers", op: "set", target: { key: "Waypoint-Public-Origin" },
      args: "https://app.example.test",
    },
  ]);
  assert.equal(JSON.stringify(config).includes(settings.NET_WORTH_ESTIMATOR_PROXY_SECRET), false);
});

test("operator settings change hosts without source changes", () => {
  const config = vercelConfig({ ...settings, BACKEND_URL: "https://different-host.test" });
  assert.equal(config.routes[0].dest, "https://different-host.test/$1");
});

test("Vercel fails closed on incomplete or unsafe deployment settings", () => {
  for (const key of Object.keys(settings)) {
    const env = { ...settings };
    delete env[key];
    assert.throws(() => vercelConfig(env), new RegExp(key));
  }
  for (const value of ["http://api.test", "https://api.test/path", "https://user:pass@api.test", "https://api.test?x=1", "https://api.test#x"]) {
    assert.throws(() => vercelConfig({ ...settings, BACKEND_URL: value }), /BACKEND_URL/);
  }
  assert.throws(() => vercelConfig({ ...settings, BACKEND_URL: settings.NET_WORTH_ESTIMATOR_PUBLIC_URL }), /must differ/);
  assert.throws(() => vercelConfig({ ...settings, NET_WORTH_ESTIMATOR_PROXY_SECRET: "short" }), /PROXY_SECRET/);
});

test("Vercel installs with bun and builds the frontend workspace", () => {
  const config = vercelConfig(settings);
  assert.equal(config.bunVersion, "1.4.x");
  assert.equal(config.installCommand, "bun install --frozen-lockfile");
  assert.equal(
    config.buildCommand,
    "bun --filter ./frontend api:generate && bun --filter ./frontend typecheck && bun --filter ./frontend build",
  );
  assert.equal(config.devCommand, "bun --filter ./frontend dev");
});

test("Vercel production deploys wait for a green main Tests run", async () => {
  assert.deepEqual(vercelConfig(settings).git, { deploymentEnabled: { main: false } });
  const workflow = readFileSync(new URL("../.github/workflows/vercel-release.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflows: \["Tests"\]/);
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /vars\.VERCEL_PROJECT_ID != ''/);
  assert.match(workflow, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
  assert.match(workflow, /VERCEL_ORG_ID: \$\{\{ vars\.VERCEL_ORG_ID \}\}/);
  assert.match(workflow, /VERCEL_PROJECT_ID: \$\{\{ vars\.VERCEL_PROJECT_ID \}\}/);
  assert.match(workflow, /v13\/deployments\?teamId=\$\{teamId\}&forceNew=1/);
  assert.match(workflow, /gitSource: \{ type: "github", repoId, ref: "main", sha \}/);
  assert.match(workflow, /target: "production"/);
  assert.match(workflow, /readyState === "READY"/);
  assert.match(workflow, /readyState === "ERROR" \|\| deployment\.readyState === "CANCELED"/);
  assert.match(workflow, /did not finish within 40 minutes/);
  assert.match(workflow, /project\.link\?\.repoId/);
  assert.doesNotMatch(workflow, /vercel@\d|npx --yes vercel|git rev-parse HEAD/);

  const source = workflow.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s*JS/)[1]
    .split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
  const execute = new (Object.getPrototypeOf(async function () {}).constructor)("process", "fetch", "console", source);
  const sha = "a".repeat(40);
  const baseEnv = {
    EVENT_NAME: "workflow_run",
    RELEASE_SHA: sha,
    TESTS_CONCLUSION: "success",
    TESTS_EVENT: "push",
    TESTS_BRANCH: "main",
  };
  await execute({ env: { ...baseEnv } }, () => assert.fail("Gate used the network"), { log() {} });
  for (const red of [{ TESTS_CONCLUSION: "failure" }, { TESTS_EVENT: "pull_request" }, { TESTS_BRANCH: "feature" }]) {
    await assert.rejects(
      execute({ env: { ...baseEnv, ...red } }, () => assert.fail("Released off the gate"), { log() {} }),
      /not a green push to main/,
    );
  }

  const dispatchEnv = {
    EVENT_NAME: "workflow_dispatch",
    RELEASE_SHA: sha,
    DISPATCH_REF: "refs/heads/main",
    GH_TOKEN: "fixture-token",
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_API_URL: "https://api.github.test",
  };
  let apiQuery;
  const dispatchFetch = async (url) => {
    apiQuery = new URL(url);
    return { ok: true, json: async () => ({ workflow_runs: [{ conclusion: "success", event: "push", head_branch: "main" }] }) };
  };
  await execute({ env: { ...dispatchEnv } }, dispatchFetch, { log() {} });
  assert.equal(apiQuery.searchParams.get("head_sha"), sha);
  await assert.rejects(
    execute({ env: { ...dispatchEnv } }, async () => ({ ok: true, json: async () => ({ workflow_runs: [] }) }), { log() {} }),
    /No successful main Tests run/,
  );
  await assert.rejects(
    execute({ env: { ...dispatchEnv, DISPATCH_REF: "refs/heads/feature" } }, () => assert.fail("Released from a branch"), { log() {} }),
    /only releases main/,
  );
});

test("the root config exports the evaluated deployment configuration", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", 'const { config } = await import("./vercel.mjs"); console.log(JSON.stringify(config));'], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, ...settings },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), vercelConfig(settings));
});
