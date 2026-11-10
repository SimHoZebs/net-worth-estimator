#!/usr/bin/env node
// Disposable end-to-end gate: real provider, real images, real browser.
//
// Spins a fully disposable environment (never the canonical stack, never
// production, never shared volumes or networks), builds the real API and
// frontend images, boots the real stack on verified-free isolated ports,
// seeds owner plus provisioned guest plus a signed-up second user, then
// drives the user journeys in a real Chromium with real password sign-in.
//
// Usage:
//   E2E_TEST_MUTATIONS=1 node auth/test-e2e.mjs [--skip-build=RUN_ID] [--cold-build] [--step=name]
//     [--timeout=seconds] [--clean]
//
//   --skip-build=RUN_ID reuse a retained run's immutable image set, never its state
//   --step=name   run the selected step and its prerequisites (partial gate)
//   --timeout=s   wall-clock budget in seconds (default E2E_BUDGET_SECONDS)
//   --clean       remove the disposable root even on failure (it is removed
//                 on success and kept on failure by default)
//   --seed-pack=p seed one fixture pack into the owner after isolation
//                 (exact guest and blank-workspace checks run first)
//   --seed-bulk=s seed tagged bulk rows NxM[:seed] beside the owner model
//
// Test-only credentials are generated per run and marked in fixture.json.
// Nothing under tmp/dev, shared volumes, or production is ever touched.
// Full teardown runs on success and on failure; leftover containers,
// volumes, or networks fail the gate.
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "./e2e-runtime.mjs";
import { chromium } from "../frontend/node_modules/@playwright/test/index.mjs";
import { snapshotFile } from "../dev/database.mjs";
import { pickFreePorts, usedSlotPorts } from "../dev/lib/slots.mjs";
import { settingsFromEnv } from "./better-auth/settings.mjs";
import { passkeyJourneys } from "./passkey-journeys.mjs";
import {
  E2E_BUDGET_SECONDS,
  E2E_DISPOSABLE_MARKER,
  E2E_SEED,
  isQuarantined,
  planSteps,
  retainedImages,
  teardownChecks,
  validateFixtureContract,
} from "./e2e-lib.mjs";
import {
  actorResource,
  directShareCycle,
  groupFeedCycle,
  guestGrantRevoke,
  guestReads,
  ownerLogout,
  ownerSignIn,
  receiptUpload,
  saveTraces,
  secondUserSignup,
  seedExtraData,
  sharedDatabaseIsolation,
} from "./e2e-journeys.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const uid = process.getuid?.() ?? 1000;
const gid = process.getgid?.() ?? 1000;

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    return match ? [match[1], match[2] ?? true] : ["_", arg];
  }),
);
if (args._) throw new Error(`unknown argument ${args._} (see header usage)`);
const onlyStep = args.step || null;
const plan = planSteps(onlyStep);
if (onlyStep) console.log(`e2e: partial gate: ${plan.join(" -> ")}; omit --step for full release evidence`);
const reuseRun = args["skip-build"];
if (reuseRun !== undefined && (typeof reuseRun !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(reuseRun)))
  throw new Error("--skip-build needs a retained run ID (for example --skip-build=20261110t120000-123)");
if (reuseRun && args["cold-build"]) throw new Error("--skip-build and --cold-build are mutually exclusive");
const budget = Number(args.timeout ?? E2E_BUDGET_SECONDS);
assert.ok(Number.isFinite(budget) && budget > 0, "--timeout needs a positive number of seconds");

assert.equal(
  process.env.E2E_TEST_MUTATIONS,
  "1",
  "Set E2E_TEST_MUTATIONS=1 to confirm this run may mutate only its own disposable fixture",
);

let runtime = createRuntime(budget * 1000);
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
const runId = `${stamp}-${process.pid}`.toLowerCase();
const project = `nwe-e2e-${runId}`;
const workRoot = resolve(root, `tmp/e2e-${runId}`);
const identityDir = resolve(workRoot, "auth");
const dataDir = resolve(workRoot, "appdata");
const logDir = resolve(workRoot, "logs");
const primaryDB = resolve(dataDir, "net-worth-estimator.db");
// Traces outlive the disposable root so a red run stays inspectable after
// teardown. The directory sits with the browser suite's other artifacts.
process.env.E2E_TRACE_DIR ??= resolve(root, "frontend/test-results/e2e", runId);
const apiTag = `nwe-e2e-api:${runId}`;
const frontTag = `nwe-e2e-front:${runId}`;
const authTag = `nwe-e2e-auth:${runId}`;

const report = [];
function record(step, status, detail = "", seconds = 0) {
  report.push({ step, status, detail, seconds });
  console.log(`e2e [${step}] ${status}${detail ? ` — ${detail}` : ""} (${seconds.toFixed(0)}s)`);
}

const sh = (cmd, argv, options) => runtime.command(cmd, argv, options);
const run = async (cmd, argv) => ({ stdout: await sh(cmd, argv) });
const waitFor = (url, options) => runtime.waitFor(url, options);

async function compose(env, ...argv) {
  return sh("docker", ["compose", "--env-file", resolve(workRoot, "e2e.env"),
    "-f", resolve(root, "docker-compose.yml"),
    "-f", resolve(root, "auth/compose.auth.yml"),
    "-f", resolve(root, "auth/compose.e2e.yml"),
    "-p", project, ...argv], { env, timeout: 600_000 });
}

async function teardown(keep) {
  const failures = [];
  try {
    if (stackStarted) await compose({}, "down", "--remove-orphans");
  } catch (error) {
    failures.push(`compose down: ${error.message}`);
  }
  for (const check of teardownChecks(runId)) {
    try {
      const out = await run(check.argv[0], check.argv.slice(1));
      const survivors = out.stdout.trim();
      if (check.expectEmpty && survivors) failures.push(`${check.name} left behind: ${survivors}`);
      else console.log(`e2e [teardown] verified: no ${check.name} remain`);
    } catch (error) {
      failures.push(`${check.name} check failed: ${error.message}`);
    }
  }
  // Never prune another session's images. Keep this run's images on failure
  // for inspection, and remove only its exact tags after a successful run.
  if (!keep) await Promise.allSettled([apiTag, frontTag, authTag].map((tag) => run("docker", ["rmi", tag])));
  if (!keep) await rm(workRoot, { recursive: true, force: true }).catch(() => {});
  else console.log(`e2e [teardown] disposable root kept at ${workRoot}`);
  return failures;
}

function pngFixture() {
  return resolve(root, "backend/internal/receipts/adapters/mock/testdata/market.png");
}

let browser;
let stackStarted = false;
const started = Date.now();
const stepFilter = (name) => plan.includes(name);
const selectionComplete = Symbol("selection complete");
const finishBoundary = (step) => { if (onlyStep === step) throw selectionComplete; };
runtime.signal.addEventListener("abort", () => { void browser?.close().catch(() => {}); }, { once: true });
let failed = false;
let teardownFailures = [];
try {
  process.umask(0o077);
  await sh("docker", ["info"], { timeout: 30_000 });
  if (onlyStep === "teardown") throw selectionComplete;
  let sourceImages;
  if (reuseRun) {
    const manifest = JSON.parse(await readFile(resolve(root, `tmp/e2e-${reuseRun}/images.json`), "utf8"));
    sourceImages = retainedImages(manifest, reuseRun);
    for (const image of sourceImages) await sh("docker", ["image", "inspect", image]);
  }
  await mkdir(identityDir, { recursive: true, mode: 0o700 });
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await mkdir(logDir, { recursive: true, mode: 0o700 });

  // ---- fixture: ports, secrets, provider seed --------------------------------
  {
    const t = Date.now();
    const used = await usedSlotPorts().catch(() => new Set());
    // Sibling gate runs keep their ports in tmp/e2e-*/e2e.env, which slot
    // scanning cannot see. Exclude them so two concurrent gates cannot pick
    // the same ports (the live-listener probe below only catches bound ones).
    try {
      for (const entry of await readdir(resolve(root, "tmp"))) {
        if (!entry.startsWith("e2e-")) continue;
        const envText = await readFile(resolve(root, "tmp", entry, "e2e.env"), "utf8").catch(() => "");
        for (const match of envText.matchAll(/^E2E_(?:AUTH|APP|GATEWAY|BACKEND)_PORT=(\d+)$/gm)) {
          used.add(Number(match[1]));
        }
      }
    } catch { /* a missing tmp dir means no siblings */ }
    const [authPort, appPort, gatewayPort, backendPort] = await pickFreePorts(4, [...used, 8080, 8787, 8000]);
    for (const [label, port] of [["provider", authPort], ["app", appPort], ["gateway", gatewayPort], ["backend", backendPort]]) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
        await response.body?.cancel();
        throw new Error(`e2e ${label} port ${port} answered; refusing to attach to a live listener`);
      } catch (error) {
        if (/refusing to attach/.test(error.message)) throw error;
      }
    }
    const secret = (bytes = 24) => randomBytes(bytes).toString("hex");
    const providerEnv = {
      AUTH_PUBLIC_URL: `http://localhost:${authPort}`,
      APP_PUBLIC_URL: `http://localhost:${appPort}`,
      AUTH_CLIENT_ID: "e2e-waypoint-client",
      AUTH_CLIENT_SECRET: secret(),
      BETTER_AUTH_SECRET: secret(),
      TEST_AUTH_USER_NAME: E2E_SEED.ownerName,
      TEST_AUTH_USER_PASSWORD: secret(),
      AUTH_STATE_DIR: identityDir,
      AUTH_DATABASE: resolve(identityDir, "identity.db"),
    };
    const settings = settingsFromEnv(providerEnv);
    await sh("bun", ["run", "auth/better-auth/test-support.ts"], { env: providerEnv });
    const ownerPass = providerEnv.TEST_AUTH_USER_PASSWORD;
    const secondPass = secret();
    const envFile = [
      "# E2E TEST-ONLY credentials. Disposable run; never production, never shared.",
      `E2E_RUN_ID=${runId}`,
      `E2E_API_IMAGE=${apiTag}`,
      `E2E_FRONT_IMAGE=${frontTag}`,
      `E2E_AUTH_PORT=${authPort}`,
      `E2E_APP_PORT=${appPort}`,
      `E2E_GATEWAY_PORT=${gatewayPort}`,
      `E2E_BACKEND_PORT=${backendPort}`,
      `E2E_DATA_DIR=${dataDir}`,
      `AUTH_STATE_DIR=${identityDir}`,
      `AUTH_PUBLIC_URL=${settings.publicUrl}`,
      `APP_PUBLIC_URL=${settings.appUrl}`,
      `AUTH_CLIENT_ID=${settings.clientId}`,
      `AUTH_CLIENT_SECRET=${settings.clientSecret}`,
      `BETTER_AUTH_SECRET=${settings.secret}`,
      `E2E_UID=${uid}`,
      `E2E_GID=${gid}`,
      `NET_WORTH_ESTIMATOR_AUTH_ISSUER=${settings.publicUrl}`,
      `NET_WORTH_ESTIMATOR_AUTH_CLIENT_ID=${settings.clientId}`,
      `NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET=${settings.clientSecret}`,
      `NET_WORTH_ESTIMATOR_PUBLIC_URL=${settings.appUrl}`,
      `NET_WORTH_ESTIMATOR_AUTH_ACCOUNT_URL=${settings.publicUrl}/account`,
      `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS=${settings.appUrl}`,
      `BACKEND_URL=http://backend:8787`,
      `E2E_OWNER_PASS=${ownerPass}`,
      `E2E_SECOND_PASS=${secondPass}`,
    ].join("\n") + "\n";
    await writeFile(resolve(workRoot, "e2e.env"), envFile, { mode: 0o600 });
    const dotenv = Object.fromEntries(
      envFile.split("\n").filter((line) => line && !line.startsWith("#")).map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
    );
    Object.assign(process.env, dotenv);
    const bootstrap = JSON.parse(await readFile(`${providerEnv.AUTH_DATABASE}.bootstrap.json`, "utf8"));
    const fixture = {
      testOnly: true,
      disposable: E2E_DISPOSABLE_MARKER,
      runId,
      stateDir: await realpath(identityDir),
      settings: { publicUrl: settings.publicUrl, appUrl: settings.appUrl },
      subject: bootstrap.subject,
      guestSubject: bootstrap.guest_subject,
      username: providerEnv.TEST_AUTH_USER_NAME,
      created: new Date().toISOString(),
    };
    const problems = validateFixtureContract(fixture, { stateDir: await realpath(identityDir), issuer: settings.publicUrl });
    assert.deepEqual(problems, [], `fixture contract violated: ${problems.join("; ")}`);
    await writeFile(resolve(identityDir, "fixture.json"), `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
    // Persist runtime secrets beside the fixture for forensics (0600, disposable root only).
    await writeFile(resolve(workRoot, "credentials.json"), JSON.stringify({
      note: "E2E TEST-ONLY credentials for disposable run; the root is removed or kept only for forensics",
      ownerName: providerEnv.TEST_AUTH_USER_NAME,
      ownerPass,
      secondName: E2E_SEED.secondName,
      secondPass,
      subject: bootstrap.subject,
      guestSubject: bootstrap.guest_subject,
    }, null, 2), { mode: 0o600 });
    record("fixture", "PASS", `provider + fixture at ${identityDir}`, (Date.now() - t) / 1000);
  }
  finishBoundary("fixture");

  const issuer = process.env.NET_WORTH_ESTIMATOR_AUTH_ISSUER;
  const appOrigin = process.env.NET_WORTH_ESTIMATOR_PUBLIC_URL;
  const ownerSubject = JSON.parse(await readFile(resolve(identityDir, "identity.db.bootstrap.json"), "utf8")).subject;
  const guestSubject = JSON.parse(await readFile(resolve(identityDir, "identity.db.bootstrap.json"), "utf8")).guest_subject;
  const ownerResource = actorResource(issuer, ownerSubject);
  const guestResource = actorResource(issuer, guestSubject);

  // ---- images: real builds ----------------------------------------------------
  {
    const t = Date.now();
    if (sourceImages) {
      for (const [index, tag] of [apiTag, frontTag, authTag].entries()) await sh("docker", ["tag", sourceImages[index], tag]);
      record("images", "PASS", "reused warm images", (Date.now() - t) / 1000);
    } else {
      const buildArgs = args["cold-build"] ? ["--no-cache"] : [];
      await sh("docker", ["build", ...buildArgs, "-f", "backend/Dockerfile", "-t", apiTag, "."], {
        timeout: 1_200_000, log: resolve(logDir, "build-api.log"),
      }).catch((error) => { throw new Error(`API image build failed (see logs/build-api.log): ${error.message}`); });
      await sh("docker", ["build", ...buildArgs, "-f", "frontend/Dockerfile", "-t", frontTag, "."], {
        timeout: 1_200_000, log: resolve(logDir, "build-front.log"),
      }).catch((error) => { throw new Error(`frontend image build failed (see logs/build-front.log): ${error.message}`); });
      await sh("docker", ["build", ...buildArgs, "-f", "auth/better-auth/Dockerfile", "-t", authTag, "."], {
        timeout: 600_000, log: resolve(logDir, "build-auth.log"),
      });
      record("images", "PASS", args["cold-build"] ? "builds of both images (no cache)" : "builds of both images (layer cache)", (Date.now() - t) / 1000);
    }
    await sh("docker", ["run", "--rm", "--network", "none", "--entrypoint", "/bin/sh", authTag, "-c", "test ! -e /app/auth/better-auth/test-support.ts && test ! -e /app/auth/better-auth/src/setup.test.ts"], { timeout: 30_000 });
    const imageIDs = await Promise.all([apiTag, frontTag, authTag].map((tag) =>
      sh("docker", ["image", "inspect", "--format", "{{.Id}}", tag]).then((id) => id.trim())));
    await writeFile(resolve(workRoot, "images.json"), JSON.stringify({
      disposable: E2E_DISPOSABLE_MARKER, runId, api: imageIDs[0], front: imageIDs[1], auth: imageIDs[2],
    }), { mode: 0o600 });
  }
  finishBoundary("images");

  // ---- stack: schema, guest row, boot ----------------------------------------
  // Helpers run image binaries with the disposable data dir mounted at
  // /data. Callers must use /data/... container paths, never host paths.
  const containerDB = "/data/net-worth-estimator.db";
  async function imageRun(image, argv, env = {}) {
    return sh("docker", ["run", "--rm", "--network", "none",
      "-v", `${dataDir}:/data`, "--user", `${uid}:${gid}`, "--env", `NET_WORTH_ESTIMATOR_DB=${containerDB}`,
      ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
      image, ...argv], { timeout: 300_000 });
  }
  async function bootStack() {
    stackStarted = true;
    await compose({}, "up", "-d", "--no-build", "--wait");
    await waitFor(`${appOrigin}/healthz`, { label: "disposable API via proxy" });
    await waitFor(appOrigin, { label: "disposable frontend" });
  }
  {
    const t = Date.now();
    await imageRun(apiTag, ["/app/setupdb", "--db", containerDB]);
    await imageRun(apiTag, ["/app/setupdb", "--db", containerDB, "--issuer", issuer, "--subject", guestSubject]);
    await imageRun(apiTag, ["/app/authzctl", "--setup", "--db", "/data/authorization.db", "--issuer", issuer, "--guest", guestSubject]);
    process.env.NET_WORTH_ESTIMATOR_GUEST_SUBJECT = guestSubject;
    await writeFile(resolve(workRoot, "e2e.env"),
      `${await readFile(resolve(workRoot, "e2e.env"), "utf8")}NET_WORTH_ESTIMATOR_GUEST_SUBJECT=${guestSubject}\n`,
      { mode: 0o600 });
    await bootStack();
    record("stack", "PASS", "schema + guest row from image binaries, stack healthy", (Date.now() - t) / 1000);
  }
  finishBoundary("stack");

  // ---- browser journeys -------------------------------------------------------
  if (stepFilter("isolation")) {
    browser = await chromium.launch({ headless: true });
    if (runtime.signal.aborted) await browser.close();
    runtime.signal.throwIfAborted();
  }
  const journeyCtx = {
    origin: appOrigin,
    issuer,
    browser,
    ownerName: E2E_SEED.ownerName,
    ownerPass: process.env.E2E_OWNER_PASS,
    ownerSubject,
    guestSubject,
    secondName: E2E_SEED.secondName,
    secondPass: process.env.E2E_SECOND_PASS,
    setGuestRole: (role) => imageRun(apiTag, ["/app/authzctl", "--db", "/data/authorization.db", "--issuer", issuer, "--guest", guestSubject, "--subject", guestSubject, "--role", role]),
  };
  async function journey(step, fn) {
    if (!stepFilter(step)) {
      record(step, "SKIP", "--step filter");
      return null;
    }
    const t = Date.now();
    try {
      const result = await fn();
      record(step, isQuarantined(step) ? "QUARANTINED-PASS" : "PASS", "", (Date.now() - t) / 1000);
      return result;
    } catch (error) {
      await saveTraces(step);
      if (isQuarantined(step)) {
        record(step, "QUARANTINED-FAIL", String(error.message).slice(0, 300), (Date.now() - t) / 1000);
        return null;
      }
      record(step, "FAIL", String(error.message).slice(0, 500));
      throw error;
    }
  }

  const ownerBundle = await journey("isolation", () => ownerSignIn(journeyCtx));
  if (ownerBundle) await journey("isolation", () => passkeyJourneys(journeyCtx, ownerBundle));
  if (ownerBundle) {
    // Publish the owner's data into the provisioned guest scope, mirroring
    // production publication, with the API stopped (SQLite-safe).
    await compose({}, "stop", "backend");
    const approved = resolve(dataDir, "approved-app.db");
    await snapshotFile(primaryDB, approved);
    await imageRun(apiTag, ["/app/refreshmodel", "--db", containerDB, "--source", "/data/approved-app.db",
      "--source-user", ownerResource, "--user", guestResource, "--financial-only"]);
    await compose({}, "start", "backend");
    await waitFor(`${appOrigin}/healthz`, { label: "API after publication" });
    const again = await (await ownerBundle.owner.request.get(`${appOrigin}/v1/auth/session`)).json();
    assert.equal(again.resource.id, ownerResource, "owner session must survive publication restart");
    const extra = await ownerBundle.owner.request.post(`${appOrigin}/v1/accounts`, {
      data: { id: "owner-later", name: "Later private account", kind: "cash", enabled: true },
      headers: { "Waypoint-Resource": ownerResource },
    });
    assert.equal(extra.status(), 200);
  }
  const guestBundle = await journey("isolation", () => guestReads(journeyCtx, ownerBundle));
  if (guestBundle) await journey("isolation", () => guestGrantRevoke(journeyCtx, guestBundle));
  async function restartStack() {
    await compose({}, "stop", "backend");
    await compose({}, "start", "backend");
    await waitFor(`${appOrigin}/healthz`, { label: "API after restart" });
  }
  const seedPack = typeof args["seed-pack"] === "string" ? args["seed-pack"] : null;
  const seedBulk = typeof args["seed-bulk"] === "string" ? args["seed-bulk"] : null;
  if (args["seed-pack"] === true || args["seed-pack"] === "" || args["seed-bulk"] === true || args["seed-bulk"] === "")
    throw new Error("--seed-pack and --seed-bulk need values (for example --seed-pack=unicode --seed-bulk=5x20:7)");
  const secondBundle = await journey("isolation", () => secondUserSignup(journeyCtx, { restartStack }));
  if (secondBundle) {
    await journey("isolation", async () => {
      const cross = await secondBundle.second.request.fetch(`${appOrigin}/v1/financial-model`, {
        headers: { "Waypoint-Resource": ownerBundle.own.resource.id },
      });
      assert.equal(cross.status(), 409, "cross-user reads with a stale scope must be rejected");
      const ownerModel = await (await ownerBundle.owner.request.fetch(`${appOrigin}/v1/financial-model`, {
        headers: { "Waypoint-Resource": ownerBundle.own.resource.id },
      })).json();
      assert.deepEqual(ownerModel.model.accounts.map((item) => item.id).sort(), [E2E_SEED.accountId, "owner-later"].sort());
    });
    await journey("isolation", () => sharedDatabaseIsolation(primaryDB, {
      ownerSubject,
      guestSubject,
      secondSubject: secondBundle.other.user.subject,
      issuer,
      guestResourceId: guestResource,
    }));
  }

  if ((seedPack || seedBulk) && ownerBundle) {
    await journey("isolation", () => seedExtraData(journeyCtx, ownerBundle, { pack: seedPack, bulk: seedBulk }));
  }

  await journey("direct-share", () => directShareCycle(journeyCtx, ownerBundle, secondBundle));
  await journey("group-feed", () => groupFeedCycle(journeyCtx, ownerBundle, secondBundle));
  await journey("receipts", () => receiptUpload(journeyCtx, ownerBundle, secondBundle, pngFixture()));

  // ---- migration against the image -------------------------------------------
  // The candidate is a snapshot copy: the image migration must verify and
  // back up without ever touching the live database file.
  await journey("migration", async () => {
    const { stdout: liveBefore } = await run("sha256sum", [primaryDB]);
    const candidate = resolve(dataDir, "migrate-candidate.db");
    await snapshotFile(primaryDB, candidate);
    const out = await sh("docker", ["run", "--rm", "--network", "none",
      "-v", `${dataDir}:/data`, "--user", `${uid}:${gid}`,
      "--env", "NET_WORTH_ESTIMATOR_DB=/data/migrate-candidate.db",
      apiTag, "/app/migrate.sh"], { timeout: 600_000, log: resolve(logDir, "migrate.log") });
    assert.match(out, /verified, nothing to do/, "complete target must repeat read-only with no writes");
    const { stdout: integrity } = await run("docker", ["run", "--rm", "--network", "none",
      "-v", `${dataDir}:/data`, "--user", `${uid}:${gid}`, apiTag,
      "sqlite3", "/data/migrate-candidate.db", "PRAGMA integrity_check;"]);
    assert.equal(integrity.trim(), "ok", "migrated candidate must pass integrity_check");
    const { stdout: fkeys } = await run("docker", ["run", "--rm", "--network", "none",
      "-v", `${dataDir}:/data`, "--user", `${uid}:${gid}`, apiTag,
      "sqlite3", "/data/migrate-candidate.db", "PRAGMA foreign_key_check;"]);
    assert.equal(fkeys.trim(), "", "migrated candidate must pass foreign_key_check");
    const { stdout: liveAfter } = await run("sha256sum", [primaryDB]);
    assert.equal(
      liveAfter.split(/\s/)[0],
      liveBefore.split(/\s/)[0],
      "image migration must leave the live database byte-identical",
    );
    console.log("e2e: image migration with backup/verify semantics PASS");
  });

  // ---- provider headers through the real proxy image --------------------------
  await journey("proxy-headers", async () => {
    await sh("node", ["--test", "scripts/nginx-provider.test.mjs", "scripts/nginx-receipts.test.mjs"], {
      env: { NGINX_TEST_IMAGE: frontTag, REQUIRE_NGINX_TEST_IMAGE: "1" },
    });
    const gateway = `http://127.0.0.1:${process.env.E2E_GATEWAY_PORT}`;
    const health = await fetch(`${gateway}/__gateway_healthz`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(health.status, 200, "provider gateway listener must answer");
    const rejected = await fetch(`${appOrigin}/v1/status`, {
      headers: { Origin: "http://unlisted.example", "Waypoint-Resource": guestResource },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(rejected.status, 403, "proxy must preserve Origin for CSRF enforcement");
    const direct = await fetch(`http://127.0.0.1:${process.env.E2E_BACKEND_PORT}/readyz`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(direct.status, 200, "direct probe must stay sessionless");
    console.log("e2e: proxy origin enforcement and gateway health PASS");
  });

  await journey("isolation", () => ownerLogout(journeyCtx, ownerBundle));
} catch (error) {
  if (error !== selectionComplete) {
    failed = true;
    console.error(`e2e: FATAL ${error.stack ?? error}`);
  }
} finally {
  if (runtime.signal.aborted) failed = true;
  runtime.dispose();
  runtime = createRuntime(120_000);
  const closingBrowser = browser?.close().catch(() => {});
  const total = (Date.now() - started) / 1000;
  try {
    teardownFailures = await teardown((failed && !args.clean) || onlyStep === "images");
  } finally { runtime.dispose(); }
  await closingBrowser;
  record("teardown", teardownFailures.length ? "FAIL" : "PASS", teardownFailures.join("; ") || "no leftovers");
  console.log(`\ne2e: ${failed || teardownFailures.length ? "RED" : onlyStep ? "PARTIAL" : "GREEN"} in ${total.toFixed(0)}s (budget ${budget}s)`);
  for (const row of report) console.log(`e2e report: ${row.step} ${row.status} ${row.seconds.toFixed(0)}s ${row.detail}`);
  if (total > budget) {
    console.error(`e2e: budget exceeded (${total.toFixed(0)}s > ${budget}s)`);
    process.exitCode = 1;
  }
  if (failed || teardownFailures.length) process.exitCode = 1;
}
