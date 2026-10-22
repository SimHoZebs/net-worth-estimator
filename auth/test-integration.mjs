// Casdoor contract test. Uses a disposable financial database and browser.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { once } from "node:events";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../frontend/node_modules/@playwright/test/index.mjs";
import { randomBytes } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicURL = process.env.NET_WORTH_ESTIMATOR_PUBLIC_URL;
const provider = process.env.NET_WORTH_ESTIMATOR_AUTH_PROVIDER;
const subject = process.env.AUTH_TEST_SUBJECT;
const username = process.env.AUTH_TEST_USERNAME;
const password = process.env.AUTH_TEST_PASSWORD;
assert.ok(publicURL && provider && subject && username && password,
  "Set the provider's NET_WORTH_ESTIMATOR_AUTH_* configuration, PUBLIC_URL, AUTH_TEST_SUBJECT, AUTH_TEST_USERNAME, and AUTH_TEST_PASSWORD.");
assert.equal(provider, "casdoor", "Mainline integration tests use Casdoor");
const origin = new URL(publicURL);
assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname), "Tests only target loopback origins.");
try {
  await fetch(new URL("/healthz", origin));
  throw new Error("The test application port is already occupied. Refusing to attach to an existing server.");
} catch (error) {
  if (error.message.includes("already occupied")) throw error;
}
await mkdir(resolve(root, "tmp"), { recursive: true });
const scratch = await mkdtemp(resolve(root, "tmp/auth-integration-"));
const binary = resolve(scratch, "server");
const build = spawn("go", ["-C", resolve(root, "backend"), "build", "-o", binary, "./cmd/server"], {
  env: { ...process.env, CGO_ENABLED: "0" }, stdio: "inherit",
});
assert.equal((await once(build, "exit"))[0], 0, "Go build failed");
const baseEnv = {
  ...process.env,
  HOST: "127.0.0.1", PORT: origin.port || "80",
  NET_WORTH_ESTIMATOR_DB: resolve(scratch, "financial.db"),
  NET_WORTH_ESTIMATOR_FRONTEND_PATH: resolve(root, "frontend/dist"),
  NET_WORTH_ESTIMATOR_AUTH_TOKEN: "",
  NET_WORTH_ESTIMATOR_READ_ONLY: "",
  NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS: origin.origin,
  NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL: "",
  NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK: "",
};
let server;
let serverLog = "";
let context;
async function start(role) {
  serverLog = "";
  server = spawn(binary, [], { env: {
    ...baseEnv,
    NET_WORTH_ESTIMATOR_AUTH_EDITORS: role === "editor" ? subject : "",
    NET_WORTH_ESTIMATOR_AUTH_READERS: role === "viewer" ? subject : "",
  }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => { serverLog += chunk; });
  server.stderr.on("data", (chunk) => { serverLog += chunk; });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`Application exited: ${serverLog}`);
    try { if ((await fetch(new URL("/healthz", origin))).ok) return; } catch { /* startup */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Application did not start: ${serverLog}`);
}
async function stop() {
  if (server && server.exitCode === null) { const exit = once(server, "exit"); server.kill("SIGTERM"); await exit; }
}
async function readSession() {
  const r = await context.request.get(`${origin.origin}/v1/auth/session`);
  assert.equal(r.status(), 200);
  return r.json();
}
async function request(method, path, data, headers = {}) {
  return context.request.fetch(`${origin.origin}${path}`, { method, data, headers });
}
const projection = { settings: {
  fallbackProjectionStartDate: "2026-01-01", horizonYears: 1,
  evaluations: { financialIndependence: [], netWorthThreshold: [], accountBalance: [], postingFulfillment: [], cycleFulfillment: [] },
} };
try {
  await start("editor");
  context = await chromium.launchPersistentContext(resolve(scratch, "browser"), { headless: true });
  assert.equal((await request("GET", "/v1/financial-model")).status(), 401);
  const page = context.pages()[0];
  await page.goto(origin.origin);
  const userInput = process.env.AUTH_TEST_USERNAME_SELECTOR
    ? page.locator(process.env.AUTH_TEST_USERNAME_SELECTOR)
    : page.locator('input[autocomplete="username"],input[autocomplete="username webauthn"],input[type="email"],input[name="username"],input#username').first();
  await userInput.fill(username);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: /^(sign in|continue with password)$/i }).last().click();
  await page.waitForURL((url) => url.origin === origin.origin && url.pathname === "/", { timeout: 30_000 });
  let session = await readSession();
  assert.equal(session.user.subject, subject);
  assert.equal(session.allowed, true);
  assert.equal((await request("GET", "/v1/financial-model")).status(), 200);
  console.log(`${provider}: automatic anonymous redirect, OIDC login, and private read PASS`);

  const created = await request("POST", "/v1/accounts", { name: "Auth integration account", kind: "cash", enabled: true });
  assert.equal(created.status(), 200);
  assert.equal((await created.json()).persisted, true);
  assert.equal((await request("POST", "/v1/accounts", { name: "CSRF attempt", kind: "cash", enabled: true }, { Origin: "https://attacker.invalid" })).status(), 403);
  console.log(`${provider}: editor write and CSRF rejection PASS`);

  const cookies = await context.cookies();
  const appCookie = cookies.find((c) => c.name === "waypoint_session");
  assert.ok(appCookie?.httpOnly && appCookie.expires > Date.now() / 1000);
  const cookie = `${appCookie.name}=${appCookie.value}`;
  await context.close();
  await stop();
  await start("viewer");
  context = await chromium.launchPersistentContext(resolve(scratch, "browser"), { headless: true });
  session = await readSession();
  assert.equal(session.authenticated, true);
  assert.equal(session.user.role, "viewer");
  assert.equal((await (await request("GET", "/v1/status")).json()).readOnly, true);
  assert.equal((await request("POST", "/v1/accounts", { name: "Denied", kind: "cash", enabled: true })).status(), 403);
  const deterministic = await request("POST", "/v1/projections/deterministic", projection);
  assert.equal(deterministic.status(), 200, await deterministic.text());
  const stream = await request("POST", "/v1/projections/stochastic", { ...projection, config: { runCount: 1, seed: 42 } });
  assert.equal(stream.status(), 200);
  assert.match(await stream.text(), /event: result/);
  console.log(`${provider}: browser/server restart, viewer permissions, and SSE PASS`);

  await stop();
  await start("none");
  assert.equal((await request("GET", "/v1/financial-model")).status(), 403);
  console.log(`${provider}: revoked application grant PASS`);

  await stop();
  await start("editor");
  const logout = await request("POST", "/v1/auth/logout");
  assert.equal(logout.status(), 200);
  assert.equal((await request("GET", "/v1/financial-model")).status(), 401);
  const replay = await fetch(`${origin.origin}/v1/financial-model`, { headers: { Cookie: cookie } });
  assert.equal(replay.status, 401);
  console.log(`${provider}: logout and captured-cookie replay rejection PASS`);
  const logoutPage = context.pages()[0];
  await logoutPage.goto((await logout.json()).logoutURL).catch(() => assert.fail("Provider logout navigation failed"));
  const loginInput = process.env.AUTH_TEST_USERNAME_SELECTOR
    ? logoutPage.locator(process.env.AUTH_TEST_USERNAME_SELECTOR)
    : logoutPage.locator('#username').first();
  await loginInput.waitFor({ state: "visible" });
  console.log(`${provider}: provider logout requires a new login PASS`);

  await logoutPage.getByRole("link", { name: /sign up now/i }).click();
  await logoutPage.locator('#username').fill(`signup-${randomBytes(6).toString('hex')}`);
  await logoutPage.locator('#name').fill('Signup integration user');
  const signupPassword = randomBytes(24).toString('hex');
  await logoutPage.locator('#password').fill(signupPassword);
  await logoutPage.locator('#confirm').fill(signupPassword);
  await logoutPage.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await logoutPage.waitForURL((url) => url.origin === origin.origin && url.pathname === '/');
  await logoutPage.getByRole('heading', { name: 'Access has not been granted' }).waitFor();
  session = await readSession();
  assert.equal(session.authenticated, true);
  assert.equal(session.allowed, false);
  assert.ok(session.user.subject && session.user.subject !== subject);
  assert.equal((await request('GET', '/v1/financial-model')).status(), 403);
  assert.equal((await request('POST', '/v1/accounts', { name: 'Denied signup', kind: 'cash', enabled: true })).status(), 403);
  console.log(`${provider}: account creation returns through OIDC without granting financial access PASS`);
} finally {
  if (context) await context.close();
  await stop();
}
