// Real-provider contract: owner, guest sample, and second account in one DB.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { chromium, expect } from "../frontend/node_modules/@playwright/test/index.mjs";
import { DatabaseSync } from "node:sqlite";
import { snapshotFile } from "../dev/database.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicURL = process.env.NET_WORTH_ESTIMATOR_PUBLIC_URL;
const subject = process.env.AUTH_TEST_SUBJECT;
const username = process.env.AUTH_TEST_USERNAME;
const password = process.env.AUTH_TEST_PASSWORD;
assert.equal(
  process.env.CASDOOR_TEST_MUTATIONS,
  "1",
  "Use an explicitly disposable Casdoor fixture",
);
assert.equal(process.env.NET_WORTH_ESTIMATOR_AUTH_PROVIDER, "casdoor");
assert.ok(
  publicURL && subject && username && password && process.env.CASDOOR_STATE_DIR,
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
const binary = resolve(scratch, "server");
const primaryDB = resolve(scratch, "financial.db");
const publisher = resolve(scratch, "refreshplan");
const setupDB = resolve(scratch, "setupdb");
const build = spawn("go", ["-C", resolve(root, "backend"), "build", "-o", binary, "./cmd/server"], {
  env: { ...process.env, CGO_ENABLED: "0" },
  stdio: "inherit",
});
assert.equal((await once(build, "exit"))[0], 0, "Go build failed");
const buildPublisher = spawn(
  "go",
  ["-C", resolve(root, "backend"), "build", "-o", publisher, "./cmd/refreshplan"],
  { stdio: "inherit" },
);
assert.equal((await once(buildPublisher, "exit"))[0], 0, "Sample publisher build failed");
const buildSetup = spawn(
  "go",
  ["-C", resolve(root, "backend"), "build", "-o", setupDB, "./cmd/setupdb"],
  { stdio: "inherit" },
);
assert.equal((await once(buildSetup, "exit"))[0], 0, "Database setup build failed");
const provision = spawn(setupDB, ["--db", primaryDB], { stdio: "inherit" });
assert.equal((await once(provision, "exit"))[0], 0, "Database setup failed");
const env = {
  ...process.env,
  HOST: "127.0.0.1",
  PORT: origin.port || "80",
  NET_WORTH_ESTIMATOR_DB: primaryDB,
  NET_WORTH_ESTIMATOR_FRONTEND_PATH: resolve(root, "frontend/dist"),
  NET_WORTH_ESTIMATOR_PLAN_OWNER_SUBJECT: subject,
  NET_WORTH_ESTIMATOR_READ_ONLY: "",
  NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS: origin.origin,
};
// Retired split-storage settings must not leak from the operator's environment.
for (const key of [
  "NET_WORTH_ESTIMATOR_SAMPLE_DB",
  "NET_WORTH_ESTIMATOR_PLANS_DIR",
  "NET_WORTH_ESTIMATOR_AUTH_SESSION_DB",
])
  delete env[key];
let server;
let browser;
let log = "";
async function start() {
  log = "";
  server = spawn(binary, [], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (data) => {
    log += data;
  });
  server.stderr.on("data", (data) => {
    log += data;
  });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`Application exited: ${log}`);
    try {
      if ((await fetch(new URL("/healthz", origin))).ok) return;
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
    await page.locator("#name").fill("Separate plan owner");
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
  assert.ok(own.resource.permissions.includes("account:write"));
  assert.equal(own.resource.kind, "private");
  const created = await request(owner, own, "POST", "/v1/accounts", {
    id: "owner-checking",
    name: "Owner checking",
    kind: "cash",
    enabled: true,
  });
  assert.equal(created.status(), 200);
  assert.equal((await created.json()).persisted, true);
  await ownerPage.reload();
  await expect(ownerPage.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  assert.equal(
    await ownerPage
      .getByRole("button", { name: "Sign out", exact: true })
      .evaluate(
        (button) =>
          !!(
            button.compareDocumentPosition(
              document.querySelector('nav[aria-label="Main navigation"]'),
            ) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
      ),
    true,
  );
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
    ["--db", primaryDB, "--source", approvedSnapshot, "--source-plan", own.resource.id, "--sample"],
    { stdio: "inherit" },
  );
  assert.equal((await once(publish, "exit"))[0], 0, "Sample publication failed");
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
  console.log("Owner OIDC login, persistent session, own-plan write, and CSRF protection PASS");

  const guest = await browser.newContext();
  const sample = await session(guest);
  assert.equal(sample.authenticated, false);
  assert.equal(sample.allowed, true);
  assert.equal(sample.resource.kind, "sample");
  const guestPage = await guest.newPage();
  await guestPage.goto(origin.origin);
  await expect(guestPage.getByText("Guest", { exact: true })).toBeVisible();
  await expect(guestPage.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(guestPage.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  assert.equal((await (await request(guest, sample, "GET", "/v1/status")).json()).readOnly, true);
  const guestModel = await (await request(guest, sample, "GET", "/v1/financial-model")).json();
  assert.deepEqual(
    guestModel.document.accounts.map((item) => item.id),
    ["owner-checking"],
  );
  assert.equal(
    (
      await request(guest, sample, "POST", "/v1/accounts", {
        name: "Blocked guest",
        kind: "cash",
        enabled: true,
      })
    ).status(),
    401,
  );
  assert.equal((await request(owner, sample, "GET", "/v1/financial-model")).status(), 409);
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
    (await request(guest, sample, "POST", "/v1/projections/deterministic", projection)).status(),
    200,
  );
  const stream = await request(guest, sample, "POST", "/v1/projections/stochastic", {
    ...projection,
    config: { runCount: 1, seed: 42 },
  });
  assert.equal(stream.status(), 200);
  assert.match(await stream.text(), /event: result/);
  console.log(
    "Separate published sample, guest read/project, denied guest writes, and stale-scope rejection PASS",
  );

  const second = await browser.newContext();
  const secondPage = await login(second, true);
  const other = await session(second);
  assert.equal(other.allowed, true);
  assert.ok(other.resource.permissions.includes("account:write"));
  assert.notEqual(other.resource.id, own.resource.id);
  const blank = (await (await request(second, other, "GET", "/v1/financial-model")).json())
    .document;
  assert.ok(blank, "Signup activates a usable blank model without an import");
  assert.deepEqual(blank.accounts, []);
  assert.deepEqual(blank.postings, []);
  assert.deepEqual(blank.recurrenceRules, []);
  await expect(secondPage.getByRole("heading", { name: "Your workspace is ready" })).toBeVisible();
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
  await secondPage.getByRole("button", { name: "Apply unsaved changes", exact: true }).click();
  await secondPage.reload();
  await expect(secondPage.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
  await secondPage.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(secondPage.locator("[data-draft-bar]")).toHaveCount(0);
  await stop();
  await start();
  await secondPage.goto(`${origin.origin}/#accounts`);
  await secondPage.reload();
  await expect(
    secondPage.getByRole("button", { name: "Open Second checking transactions", exact: true }),
  ).toBeVisible();
  const secondModel = (await (await request(second, other, "GET", "/v1/financial-model")).json())
    .document;
  assert.equal(secondModel.accounts.length, 1);
  assert.equal(secondModel.accounts[0].name, "Second checking");
  assert.equal(secondModel.checkpoints[0].Balance, 1250);
  assert.equal((await request(second, own, "GET", "/v1/financial-model")).status(), 409);
  assert.equal(
    (
      await request(second, other, "PATCH", "/v1/accounts/owner-checking", {
        name: "Cross-account attempt",
        kind: "cash",
        enabled: true,
      })
    ).status(),
    404,
  );
  const ownerModel = await (await request(owner, own, "GET", "/v1/financial-model")).json();
  assert.deepEqual(
    ownerModel.document.accounts.map((item) => item.id),
    ["owner-checking", "private-after-publication"],
  );
  const shared = new DatabaseSync(primaryDB, { readOnly: true });
  try {
    const accounts = shared.prepare("SELECT plan_id, id FROM accounts ORDER BY plan_id, id").all();
    assert.equal(
      new Set(accounts.map((row) => row.plan_id)).size,
      3,
      "Owner, sample, and second account must share one database",
    );
    assert.deepEqual(
      accounts.filter((row) => row.plan_id === sample.resource.id).map((row) => row.id),
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
    "Signup without approval/import, blank navigation, first-account draft/save, restart persistence, and storage isolation PASS",
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
  assert.equal((await session(owner)).resource.kind, "sample");
  console.log(
    "Logout removes private-plan access; captured cookies cannot restore write permission PASS",
  );
} finally {
  await browser?.close();
  await stop();
}
