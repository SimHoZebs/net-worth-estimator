import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const script = new URL("./migrate.sh", import.meta.url);
const readJSON = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("pending shared migration rejects an absent database and stays outside server startup", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-migration-noop-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(run("/bin/sh", [script.pathname], { cwd: directory, env: { PATH: directory } }), /NET_WORTH_ESTIMATOR_DB/);
  assert.deepEqual(await readdir(directory), []);
  await run("bash", ["-n", script.pathname]);
  const startup = await readFile(new URL("../backend/render-free-boot.sh", import.meta.url), "utf8");
  assert.doesNotMatch(startup, /migrate\.sh/);
});

test("Northflank serializes exact builds and gates API startup on the shared script", async () => {
  const workflow = await readJSON("./northflank/release.json");
  assert.equal(workflow.options.concurrencyPolicy, "queue");
  assert.equal(workflow.options.autorun, false);
  assert.equal(workflow.spec.spec.type, "sequential");
  assert.equal(workflow.triggers[0].kind, "webhook");
  assert.equal(workflow.triggers[0].spec.token, "INJECT_PRIVATE_WEBHOOK_TOKEN");
  const steps = workflow.spec.spec.steps;
  assert.deepEqual(steps.map((step) => step.ref), [
    "api-build", "identity-build", "identity-backup", "stop-api-writers",
    "deploy-identity-image", "deploy-maintenance-image", "migrate", "start-api",
  ]);
  for (const step of steps.slice(0, 2)) {
    assert.equal(step.condition, "success");
    assert.equal(step.spec.sha, "${args.RELEASE_SHA}");
    assert.equal(step.spec.buildRuleFallThroughHandling, "fail");
  }
  assert.equal(steps[2].condition, "success");
  assert.equal(steps[2].spec.backupType, "dump");
  for (const index of [3, 7]) {
    assert.equal(steps[index].condition, "success");
    assert.equal(steps[index].spec.templateId, "waypoint-api-command");
  }
  const maintenance = steps[3].spec.arguments.variables[0].value;
  assert.match(maintenance, /httpd -f/);
  assert.match(maintenance, /-h \/tmp\/waypoint-maintenance/);
  assert.doesNotMatch(maintenance, /\/app\/server|\/data/);
  assert.equal(steps[4].spec.origin.build, "${refs.identity-build.id}");
  assert.equal(steps[5].spec.origin.build, "${refs.api-build.id}");
  for (const index of [4, 5]) assert.equal(steps[index].condition, "running");
  const migration = steps[6].spec.spec.data;
  assert.equal(migration.options.dispatchOnly, false);
  assert.equal(migration.user, "10001");
  assert.equal(migration.group, "10001");
  assert.match(migration.command, /test -f.*NET_WORTH_ESTIMATOR_DB.*exec \/app\/migrate\.sh/);
  assert.equal(steps[7].spec.arguments.variables[0].value, "/app/render-free-boot.sh");
});

test("GitHub dispatch sends only a pinned SHA and rejects unsafe or failed webhook calls", async () => {
  const workflow = await readFile(new URL("../.github/workflows/northflank-release.yml", import.meta.url), "utf8");
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /NORTHFLANK_API_TOKEN/);
  const source = workflow.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s*JS/)[1]
    .split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
  const execute = new (Object.getPrototypeOf(async function () {}).constructor)("process", "fetch", "console", source);
  const sha = "a".repeat(40);
  let request;
  const fetch = async (url, options) => { request = { url, options }; return { ok: true }; };
  const process = { env: { RELEASE_SHA: sha, RELEASE_WEBHOOK: "https://webhooks.northflank.com/workflows/private-fixture" } };
  await execute(process, fetch, { log() {} });
  assert.equal(request.url.searchParams.get("RELEASE_SHA"), sha);
  assert.equal(request.options.redirect, "error");
  for (const webhook of ["", "https://attacker.invalid/workflows/private", "https://webhooks.northflank.com/workflows/private?override=1"]) {
    await assert.rejects(execute({ env: { RELEASE_SHA: sha, RELEASE_WEBHOOK: webhook } }, () => assert.fail("Unsafe request"), console));
  }
  await assert.rejects(execute(process, async () => ({ ok: false, status: 409 }), console), /HTTP 409/);
  await assert.rejects(execute({ env: { ...process.env, RELEASE_SHA: "latest" } }, fetch, console), /full release SHA/);
});

test("Northflank command adapter patches only the single API process", async () => {
  const template = await readJSON("./northflank/api-command.json");
  assert.equal(template.options.concurrencyPolicy, "forbid");
  assert.equal(template.options.autorun, false);
  const [patch, wait] = template.spec.spec.steps;
  assert.equal(patch.updateMode, "patch");
  assert.deepEqual(patch.spec, {
    name: "nwe-api",
    deployment: {
      instances: 1,
      docker: { configType: "customCommand", customCommand: "${args.COMMAND}" },
    },
  });
  assert.equal(wait.spec.kind, "Service");
  assert.equal(wait.spec.spec.type, "running");
});

test("API image contains the exact shared script and non-root SQLite maintenance tools", {
  skip: !process.env.DEPLOYMENT_TEST_IMAGE,
}, async () => {
  const image = process.env.DEPLOYMENT_TEST_IMAGE;
  const { stdout } = await run("docker", ["run", "--rm", "--network", "none", image, "/bin/sh", "-c", `
set -eu
test "$(id -u)" = 10001
test -x /app/migrate.sh
if /app/migrate.sh 2>/dev/null; then exit 1; fi
test ! -e "$NET_WORTH_ESTIMATOR_DB"
sqlite3 /tmp/fixture.db "CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES ('preserved');"
sqlite3 /tmp/fixture.db ".backup '/tmp/restored.db'"
test "$(sqlite3 -readonly /tmp/restored.db 'PRAGMA integrity_check;')" = ok
test "$(sqlite3 -readonly /tmp/restored.db 'SELECT value FROM fixture;')" = preserved
sha256sum /app/migrate.sh
`]);
  const expected = createHash("sha256").update(await readFile(script)).digest("hex");
  assert.equal(stdout.trim().split(/\s+/)[0], expected);
});
