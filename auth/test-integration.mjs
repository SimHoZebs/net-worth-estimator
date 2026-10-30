// Real-provider contract: owner, provisioned guest, and second user in one DB.
// Anonymous traffic resolves to the configured guest subject in the viewers group.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { chromium, expect } from "../frontend/node_modules/@playwright/test/index.mjs";
import { DatabaseSync } from "node:sqlite";
import { snapshotFile } from "../dev/database.mjs";
import { pickFreePorts } from "../dev/lib/slots.mjs";
import { casdoorSession } from "./casdoor/provision.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicURL = process.env.NET_WORTH_ESTIMATOR_PUBLIC_URL;
const subject = process.env.AUTH_TEST_SUBJECT;
const guestSubject = process.env.AUTH_TEST_GUEST_SUBJECT;
const username = process.env.AUTH_TEST_USERNAME;
const password = process.env.AUTH_TEST_PASSWORD;
assert.equal(
  process.env.CASDOOR_TEST_MUTATIONS,
  "1",
  "Use an explicitly disposable Casdoor fixture",
);
assert.equal(process.env.NET_WORTH_ESTIMATOR_AUTH_PROVIDER, "casdoor");
assert.ok(
  publicURL &&
    subject &&
    guestSubject &&
    guestSubject !== subject &&
    username &&
    password &&
    process.env.CASDOOR_STATE_DIR &&
    process.env.NET_WORTH_ESTIMATOR_AUTH_ISSUER,
  "Supply app/identity configuration and disposable test credentials",
);
const state = await realpath(process.env.CASDOOR_STATE_DIR);
assert.ok(
  [resolve(root, "tmp"), "/tmp/opencode"].some((base) => state.startsWith(base + sep)) &&
    state !== resolve(root, "tmp/dev") &&
    !state.startsWith(resolve(root, "tmp/dev") + sep),
  "Identity state must be an isolated disposable directory",
);
const fixture = JSON.parse(await readFile(resolve(state, "fixture.json"), "utf8"));
assert.equal(
  fixture.disposable,
  "waypoint-authorization-v1",
  "The identity fixture must explicitly mark its state disposable",
);
assert.equal(await realpath(fixture.stateDir), state);
assert.equal(fixture.settings.publicUrl, process.env.NET_WORTH_ESTIMATOR_AUTH_ISSUER);
// Mirror the backend ActorKey: users/<hex(sha256(issuer + "\0" + subject))>.
const actorResource = (issuer, subject) =>
  `users/${createHash("sha256").update(`${issuer}\x00${subject}`, "utf8").digest("hex")}`;
const issuer = process.env.NET_WORTH_ESTIMATOR_AUTH_ISSUER;
const ownResource = actorResource(issuer, subject);
const guestResource = actorResource(issuer, guestSubject);
assert.match(ownResource, /^users\/[0-9a-f]{64}$/);
assert.match(guestResource, /^users\/[0-9a-f]{64}$/);
assert.notEqual(guestResource, ownResource);
const origin = new URL(publicURL);
assert.ok(
  ["localhost", "127.0.0.1"].includes(origin.hostname) && origin.protocol === "http:",
  "The app test only uses unused loopback HTTP origins",
);
try {
  await fetch(new URL("/healthz", origin));
  throw new Error("Application port is occupied; refusing to attach");
} catch (error) {
  if (error.message.includes("occupied")) throw error;
}
await mkdir(resolve(root, "tmp"), { recursive: true });
const scratch = await mkdtemp(resolve(root, "tmp/auth-resource-integration-"));
const [apiPort] = await pickFreePorts(1, [Number(origin.port || "80")]);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const binary = resolve(scratch, "server");
const primaryDB = resolve(scratch, "financial.db");
const publisher = resolve(scratch, "refreshmodel");
const setupDB = resolve(scratch, "setupdb");
const build = spawn("go", ["-C", resolve(root, "backend"), "build", "-o", binary, "./cmd/server"], {
  env: { ...process.env, CGO_ENABLED: "0" },
  stdio: "inherit",
});
assert.equal((await once(build, "exit"))[0], 0, "Go build failed");
const buildPublisher = spawn(
  "go",
  ["-C", resolve(root, "backend"), "build", "-o", publisher, "./cmd/refreshmodel"],
  { stdio: "inherit" },
);
assert.equal((await once(buildPublisher, "exit"))[0], 0, "Guest publisher build failed");
const buildSetup = spawn(
  "go",
  ["-C", resolve(root, "backend"), "build", "-o", setupDB, "./cmd/setupdb"],
  { stdio: "inherit" },
);
assert.equal((await once(buildSetup, "exit"))[0], 0, "Database setup build failed");
const provision = spawn(setupDB, ["--db", primaryDB], { stdio: "inherit" });
assert.equal((await once(provision, "exit"))[0], 0, "Database setup failed");
// Provision the guest destination row before publication. The guest is an
// ordinary user; setupdb records its row and blank model, same as init.
const provisionGuest = spawn(setupDB, ["--db", primaryDB, "--issuer", issuer, "--subject", guestSubject], {
  stdio: "inherit",
});
assert.equal((await once(provisionGuest, "exit"))[0], 0, "Guest destination setup failed");
const env = {
  ...process.env,
  HOST: "127.0.0.1",
  PORT: String(apiPort),
  NET_WORTH_ESTIMATOR_DB: primaryDB,
  NET_WORTH_ESTIMATOR_OWNER_SUBJECT: subject,
  NET_WORTH_ESTIMATOR_GUEST_SUBJECT: guestSubject,
  NET_WORTH_ESTIMATOR_READ_ONLY: "",
  NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS: origin.origin,
};
let server;
let frontend;
let browser;
let log = "";
async function start() {
  log = "";
  if (!frontend) {
    frontend = spawn(process.execPath, [
      resolve(root, "frontend/node_modules/vite/bin/vite.js"),
      "preview", "--host", "127.0.0.1", "--port", origin.port || "80", "--strictPort",
    ], {
      cwd: resolve(root, "frontend"),
      env: { ...process.env, NET_WORTH_ESTIMATOR_BACKEND: apiOrigin },
      stdio: ["ignore", "pipe", "pipe"],
    });
    frontend.stdout.on("data", (data) => { log += data; });
    frontend.stderr.on("data", (data) => { log += data; });
  }
  server = spawn(binary, [], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (data) => {
    log += data;
  });
  server.stderr.on("data", (data) => {
    log += data;
  });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`Application exited: ${log}`);
    if (frontend.exitCode !== null) throw new Error(`Frontend exited: ${log}`);
    try {
      const [apiReady, frontendReady] = await Promise.all([
        fetch(`${apiOrigin}/healthz`),
        fetch(origin),
      ]);
      if (apiReady.ok && frontendReady.ok) return;
    } catch {
      /* startup */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Application did not start: ${log}`);
}
async function stop() {
  if (server?.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill("SIGTERM");
    await stopped;
  }
}
async function session(context) {
  const response = await context.request.get(`${origin.origin}/v1/auth/session`);
  assert.equal(response.status(), 200, "Identity and Casdoor resource permissions must resolve");
  const result = await response.json();
  assert.equal(response.headers()["waypoint-resource"], result.resource.id);
  return result;
}
async function request(context, scope, method, path, data, headers = {}) {
  return context.request.fetch(`${origin.origin}${path}`, {
    method,
    data,
    headers: { "Waypoint-Resource": scope.resource.id, ...headers },
  });
}
async function login(context, signup = false) {
  const page = await context.newPage();
  await page.goto(`${origin.origin}/v1/auth/login`);
  if (signup) {
    await page.getByRole("link", { name: /sign up now/i }).click();
    await page.locator("#username").fill(`isolated-${randomBytes(6).toString("hex")}`);
    await page.locator("#name").fill("Separate user owner");
    const secret = randomBytes(24).toString("hex");
    await page.locator("#password").fill(secret);
    await page.locator("#confirm").fill(secret);
    await page.getByRole("button", { name: /^sign up$/i }).click();
  } else {
    await page.locator("#username").fill(username);
    await page.locator('input[type="password"]').first().fill(password);
    await page
      .getByRole("button", { name: /^(sign in|continue with password)$/i })
      .last()
      .click();
  }
  await page.waitForURL((url) => url.origin === origin.origin && url.pathname === "/", {
    timeout: 30_000,
  });
  return page;
}
try {
  await start();
  browser = await chromium.launch({ headless: true });
  const owner = await browser.newContext();
  const ownerPage = await login(owner);
  const own = await session(owner);
  assert.equal(own.user.subject, subject);
  assert.ok(own.resource.permissions.includes("user:write"));
  assert.equal(own.resource.id, ownResource);
  assert.ok(!("kind" in own.resource), "Session resources carry id and permissions, no kind");
  const created = await request(owner, own, "POST", "/v1/accounts", {
    id: "owner-checking",
    name: "Owner checking",
    kind: "cash",
    enabled: true,
  });
  assert.equal(created.status(), 200);
  assert.equal((await created.json()).persisted, true);
  await ownerPage.reload();
  await ownerPage.goto(`${origin.origin}/#sources`);
  await ownerPage.getByRole("tab", { name: "Account", exact: true }).click();
  await expect(ownerPage.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  assert.equal(
    (
      await request(
        owner,
        own,
        "POST",
        "/v1/accounts",
        { name: "CSRF", kind: "cash", enabled: true },
        { Origin: "https://attacker.invalid" },
      )
    ).status(),
    403,
  );
  const cookies = await owner.cookies();
  const cookie = cookies.find((item) => item.name === "waypoint_session");
  assert.ok(cookie?.httpOnly && cookie.expires > Date.now() / 1000);
  await stop();
  const approvedSnapshot = resolve(scratch, "approved-app.db");
  await snapshotFile(primaryDB, approvedSnapshot);
  const publish = spawn(
    publisher,
    [
      "--db",
      primaryDB,
      "--source",
      approvedSnapshot,
      "--source-user",
      own.resource.id,
      "--user",
      guestResource,
      "--financial-only",
    ],
    { stdio: "inherit" },
  );
  assert.equal((await once(publish, "exit"))[0], 0, "Guest publication failed");
  await start();
  assert.equal((await session(owner)).resource.id, own.resource.id);
  assert.equal(
    (
      await request(owner, own, "POST", "/v1/accounts", {
        id: "private-after-publication",
        name: "Later private account",
        kind: "cash",
        enabled: true,
      })
    ).status(),
    200,
  );
  console.log("Owner OIDC login, persistent session, own-user write, and CSRF protection PASS");

  const guest = await browser.newContext();
  const published = await session(guest);
  assert.equal(published.authenticated, false);
  assert.equal(published.allowed, true);
  assert.equal(published.resource.id, guestResource);
  assert.ok(!("kind" in published.resource), "Session resources carry id and permissions, no kind");
  assert.ok(published.resource.permissions.includes("user:read"));
  assert.ok(published.resource.permissions.includes("user:project"));
  assert.ok(!published.resource.permissions.includes("user:write"));
  const guestPage = await guest.newPage();
  await guestPage.goto(`${origin.origin}/#sources`);
  await guestPage.getByRole("tab", { name: "Account", exact: true }).click();
  await expect(guestPage.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(guestPage.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  assert.equal((await (await request(guest, published, "GET", "/v1/status")).json()).readOnly, true);
  const guestModel = await (await request(guest, published, "GET", "/v1/financial-model")).json();
  assert.deepEqual(
    guestModel.model.accounts.map((item) => item.id),
    ["owner-checking"],
  );
  assert.equal(
    (
      await request(guest, published, "POST", "/v1/accounts", {
        name: "Blocked guest",
        kind: "cash",
        enabled: true,
      })
    ).status(),
    401,
  );
  assert.equal((await request(owner, published, "GET", "/v1/financial-model")).status(), 409);
  const projection = {
    settings: {
      fallbackProjectionStartDate: "2026-01-01",
      horizonYears: 1,
      evaluations: {
        financialIndependence: [],
        netWorthThreshold: [],
        accountBalance: [],
        postingFulfillment: [],
        cycleFulfillment: [],
      },
    },
    range: { startDate: "2000-01-01", endDate: "2100-01-01" },
  };
  assert.equal(
    (await request(guest, published, "POST", "/v1/projections/deterministic", projection)).status(),
    200,
  );
  const stream = await request(guest, published, "POST", "/v1/projections/stochastic", {
    ...projection,
    config: { runCount: 1, seed: 42 },
  });
  assert.equal(stream.status(), 200);
  assert.match(await stream.text(), /event: result/);
  console.log(
    "Provisioned guest read/project, denied guest writes, and stale-scope rejection PASS",
  );

  // Mutate only this marked disposable provider. Anonymous access follows
  // provider grants, including additions and revocations, without a user-kind gate.
  const admin = casdoorSession(issuer);
  await admin("/api/login", {
    method: "POST",
    body: {
      type: "login",
      signinMethod: "Password",
      application: "app-built-in",
      organization: "built-in",
      username: "admin",
      password: fixture.settings.adminPassword,
    },
  });
  const permissionPath = `?id=${encodeURIComponent("waypoint/viewer-guest-user")}`;
  const originalPermission = (await admin(`/api/get-permission${permissionPath}`)).data;
  assert.ok(originalPermission, "The disposable viewer permission must exist");
  try {
    await admin(`/api/update-permission${permissionPath}`, {
      method: "POST",
      body: { ...originalPermission, actions: ["user:read", "user:project", "user:write"] },
    });
    const writableGuest = await session(guest);
    assert.equal(writableGuest.authenticated, false);
    assert.equal(writableGuest.resource.id, guestResource);
    assert.ok(writableGuest.resource.permissions.includes("user:write"));
    assert.equal((await (await request(guest, writableGuest, "GET", "/v1/status")).json()).readOnly, false);
    const probe = await request(guest, writableGuest, "POST", "/v1/accounts", {
      id: "guest-policy-probe", name: "Guest policy probe", kind: "cash", enabled: true,
    });
    assert.equal(probe.status(), 200, "The provider can grant the ordinary guest write access");
    assert.equal((await probe.json()).persisted, true);
    assert.equal((await request(guest, writableGuest, "DELETE", "/v1/accounts/guest-policy-probe")).status(), 200);
  } finally {
    await admin(`/api/update-permission${permissionPath}`, { method: "POST", body: originalPermission });
    await admin("/api/logout", { method: "POST" });
  }
  const restoredGuest = await session(guest);
  assert.deepEqual(restoredGuest.resource.permissions, ["user:read", "user:project"]);
  assert.equal((await request(guest, restoredGuest, "POST", "/v1/accounts", {
    id: "revoked-policy-probe", name: "Revoked policy probe", kind: "cash", enabled: true,
  })).status(), 401, "The next request must observe provider write revocation");
  console.log("Ordinary guest provider grant, write, and immediate revocation PASS");

  const second = await browser.newContext();
  const secondPage = await login(second, true);
  const other = await session(second);
  assert.equal(other.allowed, true);
  assert.ok(other.resource.permissions.includes("user:write"));
  assert.notEqual(other.resource.id, own.resource.id);
  assert.notEqual(other.resource.id, guestResource);
  // The runtime bridge resolves the signup UUID through the provider
  // owner/name lookup; the session subject must be a fresh immutable subject
  // and the resource must derive from it deterministically.
  assert.ok(other.user.subject && other.user.subject !== subject);
  assert.ok(other.user.subject !== guestSubject);
  assert.equal(other.resource.id, actorResource(issuer, other.user.subject));
  assert.ok(!("kind" in other.resource), "Session resources carry id and permissions, no kind");
  const blank = (await (await request(second, other, "GET", "/v1/financial-model")).json())
    .model;
  assert.ok(blank, "Signup activates a usable blank model without an import");
  assert.deepEqual(blank.accounts, []);
  assert.deepEqual(blank.postings, []);
  assert.deepEqual(blank.recurrenceRules, []);
  await expect(secondPage.getByRole("heading", { name: "Your workspace is ready" })).toBeVisible();
  await secondPage.goto(`${origin.origin}/#sources`);
  await secondPage.getByRole("tab", { name: "Account", exact: true }).click();
  await expect(secondPage.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  // All normal pages work before the first account exists. No import or
  // administrator action occurs between native signup and the editor.
  for (const route of [
    "accounts",
    "transactions",
    "purchases",
    "evaluations",
    "sources",
    "outlook",
  ]) {
    await secondPage.goto(`${origin.origin}/#${route}`);
    await expect(secondPage.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(secondPage.getByRole("heading", { name: /No financial model/ })).toHaveCount(0);
  }
  await secondPage.getByRole("button", { name: "Add your first account" }).click();
  await secondPage.getByLabel("Account name", { exact: true }).fill("Second checking");
  await secondPage.getByLabel("Balance (USD)", { exact: true }).fill("1250");
  const accountDialog = secondPage.getByRole("dialog", { name: "Add account", exact: true });
  await accountDialog.getByRole("button", { name: "Add account", exact: true }).click();
  await expect(accountDialog).not.toBeVisible();
  await secondPage.reload();
  await stop();
  await start();
  await secondPage.goto(`${origin.origin}/#accounts`);
  await secondPage.reload();
  await expect(
    secondPage.getByRole("button", { name: "Open Second checking transactions", exact: true }),
  ).toBeVisible();
  const secondModel = (await (await request(second, other, "GET", "/v1/financial-model")).json())
    .model;
  assert.equal(secondModel.accounts.length, 1);
  assert.equal(secondModel.accounts[0].name, "Second checking");
  assert.equal(secondModel.checkpoints[0].Balance, 1250);
  assert.equal((await request(second, own, "GET", "/v1/financial-model")).status(), 409);
  assert.equal(
    (
      await request(second, other, "PATCH", "/v1/accounts/owner-checking", {
        name: "Cross-user attempt",
        kind: "cash",
        enabled: true,
      })
    ).status(),
    404,
  );
  const ownerModel = await (await request(owner, own, "GET", "/v1/financial-model")).json();
  assert.deepEqual(
    ownerModel.model.accounts.map((item) => item.id),
    ["owner-checking", "private-after-publication"],
  );
  const shared = new DatabaseSync(primaryDB, { readOnly: true });
  try {
    const users = shared.prepare("SELECT user_id, id FROM accounts ORDER BY user_id, id").all();
    assert.equal(
      new Set(users.map((row) => row.user_id)).size,
      3,
      "Owner, guest, and second user must share one database",
    );
    // Application rows key users by the store row ID (user:<hash>).
    const guestRow = `user:${guestResource.slice("users/".length)}`;
    assert.deepEqual(
      users.filter((row) => row.user_id === guestRow).map((row) => row.id),
      ["owner-checking"],
    );
    assert.ok(
      shared.prepare("SELECT COUNT(*) AS n FROM identity_grants").get().n >= 2,
      "Provider grants share the application database",
    );
  } finally {
    shared.close();
  }
  console.log(
    "Signup without approval/import, blank navigation, direct account save, restart persistence, and storage isolation PASS",
  );

  assert.equal((await request(owner, own, "POST", "/v1/auth/logout")).status(), 200);
  const replay = await fetch(`${origin.origin}/v1/accounts`, {
    method: "POST",
    headers: {
      Cookie: `${cookie.name}=${cookie.value}`,
      "Waypoint-Resource": own.resource.id,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Captured cookie attempt", kind: "cash", enabled: true }),
  });
  assert.equal(replay.status, 401);
  assert.equal((await request(owner, own, "GET", "/v1/financial-model")).status(), 409);
  const loggedOut = await session(owner);
  assert.equal(loggedOut.authenticated, false);
  assert.equal(loggedOut.resource.id, guestResource);
  console.log(
    "Logout removes private-user access; captured cookies cannot restore write permission PASS",
  );
} finally {
  await browser?.close();
  if (frontend?.exitCode === null) {
    const stopped = once(frontend, "exit");
    frontend.kill("SIGTERM");
    await stopped;
  }
  await stop();
}
