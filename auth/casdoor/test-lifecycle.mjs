// Destructive account checks for an explicitly disposable combined Compose stack.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { chromium } from "../../frontend/node_modules/@playwright/test/index.mjs";
import { settingsFromEnv } from "./generate.mjs";
import { casdoorSession } from "./provision.mjs";

assert.equal(
  process.env.CASDOOR_TEST_MUTATIONS,
  "1",
  "Explicitly permit disposable account mutations",
);
const settings = settingsFromEnv(process.env);
const scratch = await realpath(fileURLToPath(new URL("../../tmp/", import.meta.url)));
for (const path of [process.env.CASDOOR_STATE_DIR, process.env.NET_WORTH_ESTIMATOR_DB]) {
  assert.ok(path, "Set disposable identity and application database paths");
  const within = relative(scratch, await realpath(resolve(path)));
  assert.ok(
    within && !within.startsWith("..") && !within.startsWith("/"),
    "Test state must be under repository tmp/",
  );
}
for (const origin of [settings.publicUrl, settings.appUrl]) {
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
    "Tests only target loopback origins",
  );
}
const bootstrap = JSON.parse(
  await readFile(resolve(process.env.CASDOOR_STATE_DIR, "bootstrap.json"), "utf8"),
);
assert.equal(bootstrap.issuer, settings.publicUrl);
assert.equal(bootstrap.username, settings.username);
const db = new DatabaseSync(process.env.NET_WORTH_ESTIMATOR_DB, { readOnly: true });
db.exec("PRAGMA busy_timeout=5000");
const admin = casdoorSession(settings.publicUrl);
await admin("/api/login", {
  method: "POST",
  body: {
    type: "login",
    signinMethod: "Password",
    organization: "built-in",
    application: "app-built-in",
    username: "admin",
    password: settings.adminPassword,
  },
});
const appPath = "/api/get-application?id=admin%2Fwaypoint";
const userPath = `/api/get-user?id=${encodeURIComponent(`waypoint/${settings.username}`)}`;
const originalApp = (await admin(appPath)).data;
const originalUser = (await admin(userPath)).data;
assert.equal(originalUser.id, bootstrap.subject);
assert.equal(originalUser.isAdmin, false);
// Seeded creation-time memberships: groups exist, roles point at them, the
// application assigns signups to members, and subjects stay stable.
const guestPath = `/api/get-user?id=${encodeURIComponent(`waypoint/${settings.guestName}`)}`;
const guestRecord = (await admin(guestPath)).data;
assert.equal(guestRecord.id, bootstrap.guest_subject);
assert.equal(guestRecord.isAdmin, false);
assert.ok((guestRecord.groups || []).includes("waypoint/viewers"));
assert.ok(((await admin(userPath)).data.groups || []).includes("waypoint/members"));
assert.equal((await admin(appPath)).data.defaultGroup, "waypoint/members");
for (const [role, group] of [
  ["member", "waypoint/members"],
  ["viewer", "waypoint/viewers"],
]) {
  const roleRecord = (await admin(`/api/get-role?id=${encodeURIComponent(`waypoint/${role}`)}`)).data;
  assert.deepEqual(roleRecord.groups, [group]);
}
const permissionSet = (await admin("/api/get-permissions?owner=waypoint")).data;
assert.ok(
  permissionSet.every(
    (permission) =>
      permission.model !== "waypoint/user-access" || !permission.resources.includes("users/sample"),
  ),
  "No user-access permission may reference a legacy sample wire",
);
const browser = await chromium.launch({ headless: true });
let context;
let resourceID;
let passwordChanged = false;
const failures = [];
const replacement = randomBytes(24).toString("hex");
const discovery = await (
  await fetch(`${settings.publicUrl}/.well-known/openid-configuration`)
).json();

async function updateApp(app) {
  await admin("/api/update-application?id=admin%2Fwaypoint", { method: "POST", body: app });
}
async function updateUser(user) {
  await admin(`/api/update-user?id=${encodeURIComponent(`waypoint/${settings.username}`)}`, {
    method: "POST",
    body: user,
  });
}
async function deleteSessions() {
  await admin("/api/delete-session", {
    method: "POST",
    body: { owner: "waypoint", name: settings.username, application: "waypoint" },
  });
}
async function resetPassword(value) {
  await admin("/api/set-password", {
    method: "POST",
    form: {
      userOwner: "waypoint",
      userName: settings.username,
      oldPassword: "",
      newPassword: value,
    },
  });
}
function currentGrant() {
  const row = db
    .prepare("SELECT data FROM identity_grants WHERE subject=? ORDER BY rowid DESC LIMIT 1")
    .get(bootstrap.subject);
  return row ? JSON.parse(Buffer.from(row.data).toString()) : null;
}
async function eventually(check, message, timeout = 12_000) {
  const end = Date.now() + timeout;
  do {
    if (await check()) return;
    await setTimeout(200);
  } while (Date.now() < end);
  assert.fail(message);
}
async function signIn(password = settings.password) {
  if (context) await context.close();
  // Stay below Casdoor's per-user password-start burst limit.
  await setTimeout(4000);
  context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${settings.appUrl}/v1/auth/login`);
  await page.locator("#username").fill(settings.username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL((url) => url.origin === settings.appUrl && url.pathname === "/");
  const session = await (await context.request.get(`${settings.appUrl}/v1/auth/session`)).json();
  assert.equal(session.user.subject, bootstrap.subject);
  assert.equal(session.allowed, true);
  assert.ok(!("kind" in session.resource), "Session resources carry id and permissions, no kind");
  resourceID = session.resource.id;
  return page;
}
async function expectRevoked() {
  await eventually(
    async () =>
      (
        await context.request.get(`${settings.appUrl}/v1/financial-model`, {
          headers: { "Waypoint-Resource": resourceID },
        })
      ).status() === 409,
    "Revocation did not reject the old application cookie. Set the disposable API recheck interval to 2s.",
  );
  assert.ok(currentGrant() === null, "Revoked provider grant must be deleted");
}
async function expectProviderSignedOut() {
  const account = await (await context.request.get(`${settings.publicUrl}/api/get-account`)).json();
  assert.equal(account.status, "error");
  assert.equal(account.sub, "");
}

try {
  // A short real token lifetime tests refresh without database mutation or a fake clock.
  await updateApp({
    ...originalApp,
    displayName: "Sealed lifecycle test",
    expireInHours: 20 / 3600,
  });
  await updateUser({ ...originalUser, displayName: "Preserved lifecycle profile" });
  if (process.env.CASDOOR_RESTART_CONTAINER) {
    assert.equal(
      spawnSync("docker", ["restart", process.env.CASDOOR_RESTART_CONTAINER], { stdio: "ignore" })
        .status,
      0,
    );
    await eventually(
      async () => {
        try {
          return (await fetch(`${settings.publicUrl}/api/health`)).ok;
        } catch {
          return false;
        }
      },
      "Casdoor restart failed",
      60_000,
    );
  }
  const config = await readFile(resolve(process.env.CASDOOR_STATE_DIR, "conf/app.conf"), "utf8");
  assert.ok(/^initDataNewOnly = true$/m.test(config), "Future imports must be new-only");
  assert.ok(/^initDataMerge = false$/m.test(config), "Future imports must not merge seed data");
  assert.equal((await admin(appPath)).data.displayName, "Sealed lifecycle test");
  assert.equal((await admin(userPath)).data.displayName, "Preserved lifecycle profile");
  assert.equal((await admin(userPath)).data.id, bootstrap.subject);
  console.log(
    "PASS sealed bootstrap preserves generated subject and operator settings across restart",
  );

  // Live five-field bridge over the real provider: member writes allow,
  // viewer writes deny, cross-user requests deny on actor/owner mismatch.
  const actorHash = (subject) =>
    createHash("sha256").update(`${settings.publicUrl}\x00${subject}`, "utf8").digest("hex");
  const ownerActor = `user:${actorHash(bootstrap.subject)}`;
  const guestActor = `user:${actorHash(bootstrap.guest_subject)}`;
  const appCredentials = `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString("base64")}`;
  async function batchEnforce(permissionId, rows) {
    const response = await fetch(
      `${settings.publicUrl}/api/batch-enforce?${new URLSearchParams({ permissionId })}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: appCredentials },
        body: JSON.stringify(rows),
      },
    );
    const result = await response.json();
    assert.equal(result.status, "ok", `Batch enforce failed for ${permissionId}`);
    return result.data;
  }
  const ownerScope = `users/${ownerActor.slice("user:".length)}`;
  const guestScope = `users/${guestActor.slice("user:".length)}`;
  const ownerSub = `waypoint/${settings.username}`;
  const guestSub = `waypoint/${settings.guestName}`;
  assert.deepEqual(
    await batchEnforce("waypoint/member-private-user", [
      [ownerSub, ownerScope, "user:read", ownerActor, ownerActor],
      [ownerSub, ownerScope, "user:project", ownerActor, ownerActor],
      [ownerSub, ownerScope, "user:write", ownerActor, ownerActor],
    ]),
    [true, true, true],
  );
  assert.deepEqual(
    await batchEnforce("waypoint/viewer-guest-user", [
      [ownerSub, ownerScope, "user:write", ownerActor, ownerActor],
    ]),
    [false],
  );
  assert.deepEqual(
    await batchEnforce("waypoint/viewer-guest-user", [
      [guestSub, guestScope, "user:read", guestActor, guestActor],
      [guestSub, guestScope, "user:project", guestActor, guestActor],
      [guestSub, guestScope, "user:write", guestActor, guestActor],
    ]),
    [true, true, false],
  );
  assert.deepEqual(
    await batchEnforce("waypoint/member-private-user", [
      [guestSub, guestScope, "user:write", guestActor, guestActor],
      [ownerSub, guestScope, "user:read", guestActor, ownerActor],
    ]),
    [false, false],
  );
  console.log("PASS live member-write allow, viewer-write deny, and cross-user deny");

  // Signup joins members through the application defaultGroup: the new user
  // can write its own scope and the provider UUID lookup stays stable.
  const signupContext = await browser.newContext();
  try {
    const signupPage = await signupContext.newPage();
    const signupName = `lifecycle-${randomBytes(4).toString("hex")}`;
    const signupSecret = randomBytes(24).toString("hex");
    await signupPage.goto(`${settings.appUrl}/v1/auth/login`);
    await signupPage.getByRole("link", { name: /sign up now/i }).click();
    await signupPage.locator("#username").fill(signupName);
    await signupPage.locator("#name").fill("Lifecycle member");
    await signupPage.locator("#password").fill(signupSecret);
    await signupPage.locator("#confirm").fill(signupSecret);
    await signupPage.getByRole("button", { name: /^sign up$/i }).click();
    await signupPage.waitForURL(
      (url) => url.origin === settings.appUrl && url.pathname === "/",
      { timeout: 30_000 },
    );
    const memberSession = await (
      await signupContext.request.get(`${settings.appUrl}/v1/auth/session`)
    ).json();
    assert.equal(memberSession.allowed, true);
    assert.ok(
      memberSession.resource.permissions.includes("user:write"),
      "Signup default-group access must grant member writes",
    );
    const memberRecord = (
      await admin(`/api/get-user?id=${encodeURIComponent(`waypoint/${signupName}`)}`)
    ).data;
    assert.ok(
      (memberRecord.groups || []).includes("waypoint/members"),
      "Signup must join members through defaultGroup",
    );
    assert.equal(memberRecord.id, memberSession.user.subject, "UUID profile lookup must stay stable");
    assert.equal(memberSession.resource.id, `users/${actorHash(memberRecord.id)}`);
  } finally {
    await signupContext.close();
  }
  console.log("PASS signup automatic default-group access and stable UUID profile lookup");

  // Anonymous traffic resolves to the provisioned guest scope: id and
  // permissions, no kind, and no sample wire anywhere in the response.
  const anonymous = await browser.newContext();
  try {
    const guestSession = await (
      await anonymous.request.get(`${settings.appUrl}/v1/auth/session`)
    ).json();
    assert.equal(guestSession.authenticated, false);
    assert.equal(guestSession.resource.id, guestScope);
    assert.ok(!("kind" in guestSession.resource));
    assert.ok(JSON.stringify(guestSession).indexOf("sample") === -1);
  } finally {
    await anonymous.close();
  }
  console.log("PASS anonymous session resolves to the provisioned guest scope");

  await signIn();
  const before = currentGrant();
  assert.ok(before?.RefreshToken);
  await setTimeout(12_000);
  const responses = await Promise.all(
    Array.from({ length: 12 }, () =>
      context.request.get(`${settings.appUrl}/v1/financial-model`, {
        headers: { "Waypoint-Resource": resourceID },
      }),
    ),
  );
  assert.ok(
    responses.every((response) => response.status() === 200),
    "Concurrent refresh must preserve access",
  );
  const after = currentGrant();
  assert.ok(after.RefreshToken !== before.RefreshToken, "Refresh credential must rotate");
  assert.ok(after.AccessToken !== before.AccessToken, "Access credential must rotate");
  assert.equal(after.Expiry, before.Expiry);
  console.log(
    "PASS real rotating refresh, concurrent API requests, and fixed application deadline",
  );

  await updateUser({ ...(await admin(userPath)).data, isForbidden: true });
  await expectRevoked();
  await updateUser({ ...(await admin(userPath)).data, isForbidden: false });
  console.log("PASS account disablement ends existing application access");

  await signIn();
  const revocation = await fetch(discovery.revocation_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      token: currentGrant().AccessToken,
      token_type_hint: "access_token",
    }),
  });
  assert.equal(revocation.status, 200);
  await expectRevoked();
  console.log("PASS provider token revocation ends existing application access");

  await signIn();
  await deleteSessions();
  await expectRevoked();
  await expectProviderSignedOut();
  console.log("PASS administrator session deletion rejects provider and application cookies");

  await signIn();
  await resetPassword(replacement);
  passwordChanged = true;
  await expectRevoked();
  await deleteSessions();
  await expectProviderSignedOut();
  const oldPassword = await fetch(`${settings.publicUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "login",
      signinMethod: "Password",
      application: "waypoint",
      organization: "waypoint",
      username: settings.username,
      password: settings.password,
    }),
  });
  const rejection = await oldPassword.json();
  assert.equal(rejection.status, "error");
  assert.ok(
    /password/i.test(rejection.msg),
    "Old password must fail credential validation, not a rate limit",
  );
  console.log("PASS administrator recovery rejects old password, tokens, and provider sessions");

  const page = await signIn(replacement);
  const g = currentGrant();
  const cookies = await context.cookies(settings.appUrl);
  const captured = cookies
    .filter((cookie) => cookie.name.endsWith("waypoint_session"))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  const logoutIDs = () =>
    db
      .prepare("SELECT jti FROM identity_logout_tokens")
      .all()
      .map((row) => row.jti);
  const priorLogoutIDs = new Set(logoutIDs());
  const logout = new URL(discovery.end_session_endpoint);
  logout.search = new URLSearchParams({
    client_id: settings.clientId,
    id_token_hint: g.IDToken,
    post_logout_redirect_uri: `${settings.appUrl}/`,
  });
  await page.goto(logout.href).catch(() => assert.fail("Provider logout navigation failed"));
  // The receiver prunes expired records while it inserts the new token ID.
  // A new delivery can therefore leave the total row count unchanged.
  await eventually(
    () => logoutIDs().some((id) => !priorLogoutIDs.has(id)),
    "Signed logout did not reach the API over the private network",
  );
  await expectRevoked();
  assert.equal(
    (
      await fetch(`${settings.appUrl}/v1/financial-model`, {
        headers: { Cookie: captured, "Waypoint-Resource": resourceID },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await fetch(`${settings.appUrl}/v1/accounts`, {
        method: "POST",
        headers: { Cookie: captured, "Waypoint-Resource": resourceID },
      })
    ).status,
    401,
  );
  console.log(
    "PASS real signed back-channel delivery, subject revocation, and captured-cookie rejection",
  );
} catch (error) {
  failures.push(error);
} finally {
  try {
    for (const restore of [
      () => updateUser(originalUser),
      () => updateApp(originalApp),
      ...(passwordChanged ? [() => resetPassword(settings.password)] : []),
      deleteSessions,
      () => admin("/api/logout", { method: "POST" }),
    ]) {
      try {
        await restore();
      } catch (error) {
        failures.push(error);
      }
    }
  } finally {
    if (context) await context.close();
    await browser.close();
    db.close();
  }
}
if (failures.length)
  throw new AggregateError(failures, "Disposable lifecycle checks or cleanup failed");
