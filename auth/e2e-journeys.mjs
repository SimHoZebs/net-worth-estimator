// End-to-end user journeys against a disposable real stack.
//
// Every journey drives the real built frontend through a real Chromium
// session against a real provider and real API images. Requests ride the
// same session cookies, resource headers, and CSRF checks as production
// traffic. API payload shapes mirror the tested backend contracts (see the
// QA-03 integration journeys for the same shapes with a stand-in identity).
//
// Assertions stay deterministic: fixed calendar dates, fixed entity names,
// and no clock-dependent expectations. Random values appear only where the
// provider requires uniqueness per attempt (idempotency keys); no assertion
// depends on them.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "../frontend/node_modules/@playwright/test/index.mjs";
import { DatabaseSync } from "node:sqlite";
import { E2E_SEED, E2E_TRANSPORT_ATTEMPTS } from "./e2e-lib.mjs";
import { casdoorSession } from "./casdoor/provision.mjs";

export function actorResource(issuer, subject) {
  return `users/${createHash("sha256").update(`${issuer}\x00${subject}`, "utf8").digest("hex")}`;
}

export function userRowId(resource) {
  return `user:${resource.slice("users/".length)}`;
}

// Transport retry budget: navigation and readiness polling may retry;
// assertion failures throw through immediately.
export async function withTransport(fn, label) {
  let last;
  for (let attempt = 1; attempt <= E2E_TRANSPORT_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (error?.name === "AssertionError" || /assert/i.test(error?.constructor?.name ?? "")) throw error;
      if (attempt === E2E_TRANSPORT_ATTEMPTS) break;
      await new Promise((done) => setTimeout(done, 500 * attempt));
    }
  }
  throw new Error(`transport failed (${label}): ${last?.message ?? last}`);
}

export async function session(context, origin) {
  const response = await context.request.get(`${origin}/v1/auth/session`);
  assert.equal(response.status(), 200, "identity and resource permissions must resolve");
  const result = await response.json();
  assert.equal(response.headers()["waypoint-resource"], result.resource.id);
  return result;
}

export async function api(context, origin, scope, method, path, data, headers = {}) {
  return context.request.fetch(`${origin}${path}`, {
    method,
    data,
    headers: { "Waypoint-Resource": scope.resource.id, ...headers },
  });
}

export function requestId() {
  return randomUUID();
}

// Every journey context records a trace. The orchestrator keeps the archives
// only for failing steps, so a green run pays the recording cost and nothing
// else, and a red run leaves clickable timelines instead of bare messages.
// Shared contexts keep recording across saves so a second red step later in
// the run still leaves an archive.
const tracedContexts = [];
let traceSaves = 0;
const TRACE_OPTIONS = { screenshots: true, snapshots: true, sources: true };

export async function newTracedContext(browser, options) {
  const context = await browser.newContext(options);
  if (process.env.E2E_TRACE_DIR) {
    await context.tracing.start(TRACE_OPTIONS);
    tracedContexts.push(context);
  }
  return context;
}

export async function saveTraces(label) {
  const directory = process.env.E2E_TRACE_DIR;
  if (!directory || tracedContexts.length === 0) return [];
  mkdirSync(directory, { recursive: true });
  traceSaves += 1;
  const written = [];
  const failures = [];
  let index = 0;
  for (const context of tracedContexts) {
    index += 1;
    const path = join(directory, `${label}-${traceSaves}-${index}.zip`);
    try {
      await context.tracing.stop({ path });
      written.push(path);
    } catch (error) {
      failures.push(`trace stop failed: ${error?.message ?? error}`);
    }
    try {
      await context.tracing.start(TRACE_OPTIONS);
    } catch (error) {
      failures.push(`trace restart failed: ${error?.message ?? error}`);
    }
  }
  if (written.length > 0)
    console.log(`e2e: trace saved to ${directory} (${label})`);
  for (const failure of failures) console.error(`e2e: ${failure}`);
  return written;
}

async function signInPage(context, origin, { username, password, signup }) {
  const page = await context.newPage();
  await withTransport(() => page.goto(`${origin}/v1/auth/login`), "login redirect");
  if (signup) {
    await page.getByRole("link", { name: /sign up now/i }).click();
    await page.locator("#username").fill(username);
    await page.locator("#name").fill(E2E_SEED.secondDisplay);
    await page.locator("#password").fill(password);
    await page.locator("#confirm").fill(password);
    await page.getByRole("button", { name: /^sign up$/i }).click();
  } else {
    await page.locator("#username").fill(username);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole("button", { name: /^(sign in|continue with password)$/i }).last().click();
  }
  await page.waitForURL((url) => url.origin === new URL(origin).origin && url.pathname === "/", {
    timeout: 60_000,
  });
  return page;
}

// Owner password sign-in, first private write, CSRF denial, cookie flags.
// Returns the owner context, page, session scope, and captured cookie.
export async function ownerSignIn(ctx) {
  const { origin, browser, ownerName, ownerPass, issuer, ownerSubject } = ctx;
  const owner = await newTracedContext(browser);
  const page = await signInPage(owner, origin, { username: ownerName, password: ownerPass });
  const own = await session(owner, origin);
  const ownResource = actorResource(issuer, ownerSubject);
  assert.equal(own.user.subject, ownerSubject);
  assert.ok(own.resource.permissions.includes("user:write"));
  assert.equal(own.resource.id, ownResource);
  assert.ok(!("kind" in own.resource), "session resources carry id and permissions, no kind");

  const created = await api(owner, origin, own, "POST", "/v1/accounts", {
    id: E2E_SEED.accountId,
    name: E2E_SEED.accountName,
    kind: "cash",
    enabled: true,
  });
  assert.equal(created.status(), 200);
  assert.equal((await created.json()).saved, true);

  await page.reload();
  await page.goto(`${origin}/#sources`);
  await page.getByRole("tab", { name: "Account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  assert.equal(
    (await api(owner, origin, own, "POST", "/v1/accounts", { name: "CSRF", kind: "cash", enabled: true }, { Origin: "https://attacker.invalid" })).status(),
    403,
  );
  const cookie = (await owner.cookies()).find((item) => item.name === "waypoint_session");
  assert.ok(cookie?.httpOnly, "session cookie must be HttpOnly");
  console.log("e2e: owner password sign-in, first write, CSRF denial PASS");
  return { owner, page, own, cookie };
}

// Anonymous traffic resolves to the provisioned guest scope: reads and
// projections allowed, writes denied, stale scopes rejected.
export async function guestReads(ctx, ownerBundle) {
  const { origin, browser, issuer, guestSubject } = ctx;
  const { owner, own } = ownerBundle;
  const guestResource = actorResource(issuer, guestSubject);
  const guest = await newTracedContext(browser);
  const published = await session(guest, origin);
  assert.equal(published.authenticated, false);
  assert.equal(published.allowed, true);
  assert.equal(published.resource.id, guestResource);
  assert.ok(!("kind" in published.resource));
  assert.ok(published.resource.permissions.includes("user:read"));
  assert.ok(published.resource.permissions.includes("user:project"));
  assert.ok(!published.resource.permissions.includes("user:write"));

  const guestPage = await guest.newPage();
  await guestPage.goto(`${origin}/#sources`);
  await guestPage.getByRole("tab", { name: "Account", exact: true }).click();
  await expect(guestPage.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(guestPage.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  assert.equal((await (await api(guest, origin, published, "GET", "/v1/status")).json()).readOnly, true);
  const model = await (await api(guest, origin, published, "GET", "/v1/financial-model")).json();
  assert.deepEqual(model.model.accounts.map((item) => item.id), [E2E_SEED.accountId]);
  assert.equal(
    (await api(guest, origin, published, "POST", "/v1/accounts", { name: "Blocked guest", kind: "cash", enabled: true })).status(),
    401,
  );
  assert.equal((await api(owner, origin, published, "GET", "/v1/financial-model")).status(), 409);

  const projection = {
    settings: {
      fallbackProjectionStartDate: E2E_SEED.postingDay,
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
    (await api(guest, origin, published, "POST", "/v1/projections/deterministic", projection)).status(),
    200,
  );
  const stream = await api(guest, origin, published, "POST", "/v1/projections/stochastic", {
    ...projection,
    config: { runCount: 1, seed: 42 },
  });
  assert.equal(stream.status(), 200);
  assert.match(await stream.text(), /event: result/);
  console.log("e2e: guest read/project, denied writes, stale-scope rejection PASS");
  return { guest, published };
}

// Anonymous access follows provider grants only: a viewer permission grant
// enables guest writes, and revocation is observed on the next request —
// with no user-kind branch in the runtime path.
export async function guestGrantRevoke(ctx, guestBundle) {
  const { origin, issuer, adminPassword } = ctx;
  const { guest, published } = guestBundle;
  const guestResource = actorResource(issuer, ctx.guestSubject);
  const admin = casdoorSession(issuer);
  await admin("/api/login", {
    method: "POST",
    body: {
      type: "login",
      signinMethod: "Password",
      application: "app-built-in",
      organization: "built-in",
      username: "admin",
      password: adminPassword,
    },
  });
  const permissionPath = `?id=${encodeURIComponent("waypoint/viewer-guest-user")}`;
  const original = (await admin(`/api/get-permission${permissionPath}`)).data;
  assert.ok(original, "the disposable viewer permission must exist");
  try {
    await admin(`/api/update-permission${permissionPath}`, {
      method: "POST",
      body: { ...original, actions: ["user:read", "user:project", "user:write"] },
    });
    const writable = await session(guest, origin);
    assert.ok(writable.resource.permissions.includes("user:write"));
    const probe = await api(guest, origin, writable, "POST", "/v1/accounts", {
      id: "e2e-policy-probe",
      name: "E2E policy probe",
      kind: "cash",
      enabled: true,
    });
    assert.equal(probe.status(), 200, "the provider grant must enable the ordinary guest write");
    assert.equal((await probe.json()).saved, true);
    assert.equal((await api(guest, origin, writable, "DELETE", "/v1/accounts/e2e-policy-probe")).status(), 200);
  } finally {
    await admin(`/api/update-permission${permissionPath}`, { method: "POST", body: original });
    await admin("/api/logout", { method: "POST" });
  }
  const restored = await session(guest, origin);
  assert.deepEqual(restored.resource.permissions, ["user:read", "user:project"]);
  assert.equal(
    (await api(guest, origin, restored, "POST", "/v1/accounts", { name: "Revoked probe", kind: "cash", enabled: true })).status(),
    401,
    "the next request must observe provider write revocation",
  );
  console.log("e2e: guest provider grant, write, and immediate revocation PASS");
}

// Second user arrives through native signup: immediate blank workspace, no
// administrator approval or import, first-account editing, and restart
// persistence across a real stack restart.
export async function secondUserSignup(ctx, hooks) {
  const { origin, browser, issuer, ownerSubject, guestSubject, secondName, secondPass } = ctx;
  const second = await newTracedContext(browser);
  const page = await signInPage(second, origin, { username: secondName, password: secondPass, signup: true });
  const other = await session(second, origin);
  assert.equal(other.allowed, true);
  assert.ok(other.resource.permissions.includes("user:write"));
  assert.ok(other.user.subject && other.user.subject !== ownerSubject);
  assert.ok(other.user.subject !== guestSubject);
  assert.equal(other.resource.id, actorResource(issuer, other.user.subject));
  assert.ok(!("kind" in other.resource));

  const blank = (await (await api(second, origin, other, "GET", "/v1/financial-model")).json()).model;
  assert.deepEqual(blank.accounts, []);
  assert.deepEqual(blank.postings, []);
  await expect(page.getByRole("heading", { name: "Your workspace is ready" })).toBeVisible();
  for (const route of ["accounts", "transactions", "purchases", "evaluations", "sources", "outlook"]) {
    await page.goto(`${origin}/#${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /No financial model/ })).toHaveCount(0);
  }
  // The first-account entry point lives on the landing route the signup
  // flow ends on (mirrors the proven order: loop, then click in place).
  await page.getByRole("button", { name: "Add your first account" }).click();
  await page.getByLabel("Account name", { exact: true }).fill("Second checking");
  await page.getByLabel("Balance (USD)", { exact: true }).fill("1250");
  const dialog = page.getByRole("dialog", { name: "Add account", exact: true });
  await dialog.getByRole("button", { name: "Add account", exact: true }).click();
  await expect(dialog).not.toBeVisible();

  await hooks.restartStack();
  await page.goto(`${origin}/#accounts`);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open Second checking transactions", exact: true }),
  ).toBeVisible();
  const model = (await (await api(second, origin, other, "GET", "/v1/financial-model")).json()).model;
  assert.equal(model.accounts.length, 1);
  assert.equal(model.accounts[0].name, "Second checking");
  console.log("e2e: signup, blank navigation, first account, restart persistence PASS");
  return { second, page, other };
}

function transactionPayload(row) {
  const transaction = new Date((row.transactionTime ?? row.postedTime) * 1000).toISOString();
  const posted = new Date(row.postedTime * 1000).toISOString();
  return {
    id: row.id,
    name: row.name,
    sourceAccountId: row.sourceAccountId ?? null,
    destinations: row.destinations ?? [],
    amount: row.amount?.resolver
      ? row.amount
      : { resolver: "expression", config: { expression: "25.00" }, inputs: {} },
    date: transaction.slice(0, 10),
    time: transaction.slice(11, 19),
    postedDate: posted.slice(0, 10),
    enabled: row.enabled ?? true,
  };
}

function postingPayload(name, sourceAccountId) {
  return transactionPayload({
    name,
    sourceAccountId,
    destinations: [],
    amount: 25,
    postedTime: E2E_SEED.postedTime,
    transactionTime: E2E_SEED.postedTime,
    enabled: true,
  });
}

async function createPosting(ctx, ownerBundle, name, accountId = E2E_SEED.accountId) {
  const { origin } = ctx;
  const { owner, own } = ownerBundle;
  const response = await api(owner, origin, own, "POST", "/v1/transactions", postingPayload(name, accountId));
  assert.equal(response.status(), 200, `create posting ${name}: ${await response.text()}`);
  const body = await response.json();
  assert.equal(body.saved, true);
  return body.value.id;
}

// Share → inbox accept → copy → revoke across two real users. Accepting
// saves an independent copy (retry-safe); declining removes the grant;
// revocation denies reads without leaking existence while the copy survives.
export async function directShareCycle(ctx, ownerBundle, secondBundle) {
  const { origin } = ctx;
  const { owner, own } = ownerBundle;
  const { second, other } = secondBundle;
  const ownerResource = own.resource.id;
  const memberUserId = userRowId(other.resource.id);

  const gift = await createPosting(ctx, ownerBundle, "E2E gift");
  const declinedGift = await createPosting(ctx, ownerBundle, "E2E declined gift");
  for (const postingId of [gift, declinedGift]) {
    const granted = await api(owner, origin, own, "POST", "/v1/shared/grants", {
      postingId,
      audienceType: "user",
      audienceId: memberUserId,
      requestId: requestId(),
    });
    assert.equal(granted.status(), 201, `grant ${postingId}: ${await granted.text()}`);
  }
  const shareRef = (postingId) => ({ owner: ownerResource, postingId });

  const pending = await (await api(second, origin, other, "GET", "/v1/inbox")).json();
  assert.equal(pending.items.length, 2, `inbox items = ${JSON.stringify(pending)}`);

  const dismissed = await api(second, origin, other, "POST", "/v1/inbox/shares/dismiss", shareRef(gift));
  assert.equal(dismissed.status(), 200);
  assert.equal((await dismissed.json()).item.dismissed, true);
  const hidden = await (await api(second, origin, other, "GET", "/v1/inbox")).json();
  assert.equal(hidden.items.length, 1);
  const restored = await api(second, origin, other, "POST", "/v1/inbox/shares/dismiss", {
    ...shareRef(gift),
    dismissed: false,
  });
  assert.equal(restored.status(), 200);

  const accepted = await api(second, origin, other, "POST", "/v1/inbox/shares/accept", shareRef(gift));
  assert.equal(accepted.status(), 200);
  const firstCopy = (await accepted.json()).item.copyPostingId;
  assert.ok(firstCopy, "accept must save a copy");
  const retried = await api(second, origin, other, "POST", "/v1/inbox/shares/accept", shareRef(gift));
  assert.equal(retried.status(), 200);
  assert.equal((await retried.json()).item.copyPostingId, firstCopy, "accept retry must return the same copy");

  const declined = await api(second, origin, other, "POST", "/v1/inbox/shares/decline", shareRef(declinedGift));
  assert.equal(declined.status(), 200);
  assert.equal((await declined.json()).item.status, "declined");

  const revoked = await api(owner, origin, own, "DELETE", "/v1/shared/grants", {
    postingId: gift,
    audienceType: "user",
    audienceId: memberUserId,
    requestId: requestId(),
  });
  assert.equal(revoked.status(), 200);
  const denied = await api(second, origin, other, "GET", `/v1/shared/postings/${ownerResource}/${gift}`);
  assert.equal(denied.status(), 404, "revoked read must deny without existence leakage");

  const memberModel = (await (await api(second, origin, other, "GET", "/v1/financial-model")).json()).model;
  const copyRow = memberModel.postings.find((row) => row.id === firstCopy);
  assert.ok(copyRow, "the accepted copy must survive revocation");
  console.log("e2e: share → inbox accept → copy → revoke PASS");
}

// Group policy → feed → exclusion across two real users. The member feed
// shows viewer totals over exactly the policy set; an exclusion narrows
// feed and totals together; revocation plus policy-off denies reads while
// the explicitly granted copy survives as a private row.
export async function groupFeedCycle(ctx, ownerBundle, secondBundle) {
  const { origin } = ctx;
  const { owner, own } = ownerBundle;
  const { second, other } = secondBundle;
  const ownerResource = own.resource.id;

  // A dedicated account scopes the feed to this journey's rows: the
  // direct-share journey already wrote postings to the default account, and
  // the policy feeds every row in its listed accounts.
  const groupAccount = "e2e-group-checking";
  const groupChecking = await api(owner, origin, own, "POST", "/v1/accounts", {
    id: groupAccount,
    name: "E2E group checking",
    kind: "cash",
    enabled: true,
  });
  assert.equal(groupChecking.status(), 200, `create group account: ${await groupChecking.text()}`);
  const created = await api(owner, origin, own, "POST", "/v1/groups", { name: E2E_SEED.groupName });
  assert.equal(created.status(), 201, `create group: ${await created.text()}`);
  const groupId = (await created.json()).group.id;
  assert.ok(groupId, "group must carry an id");

  const invite = await api(owner, origin, own, "POST", `/v1/groups/${groupId}/invites`, { maxUses: 5 });
  assert.equal(invite.status(), 201);
  const code = (await invite.json()).code;
  assert.ok(code, "invite must carry a code");
  const joined = await api(second, origin, other, "POST", "/v1/invites/accept", { code });
  assert.equal(joined.status(), 200, `accept invite: ${await joined.text()}`);

  const groceries = await createPosting(ctx, ownerBundle, "E2E groceries", groupAccount);
  const fuel = await createPosting(ctx, ownerBundle, "E2E fuel", groupAccount);
  const policy = await api(owner, origin, own, "PUT", `/v1/shared/policies/${groupId}`, {
    enabled: true,
    accountIds: [groupAccount],
    startDate: E2E_SEED.rangeStart,
    endDate: E2E_SEED.rangeEnd,
  });
  assert.equal(policy.status(), 200, `set policy: ${await policy.text()}`);

  const feedTarget = `/v1/shared/groups/${groupId}/feed`;
  const feed = await (await api(second, origin, other, "GET", feedTarget)).json();
  assert.equal(feed.items.length, 2, `feed items = ${JSON.stringify(feed.totals)}`);
  assert.equal(feed.totals.count, 2);

  const granted = await api(owner, origin, own, "POST", "/v1/shared/grants", {
    postingId: groceries,
    audienceType: "group",
    audienceId: groupId,
    requestId: requestId(),
  });
  assert.equal(granted.status(), 201);
  const copied = await api(second, origin, other, "POST", "/v1/shared/copies", {
    owner: ownerResource,
    postingId: groceries,
    requestId: requestId(),
  });
  assert.equal(copied.status(), 201, `save copy: ${await copied.text()}`);
  const copyRow = (await copied.json()).posting;
  assert.ok(copyRow.id && copyRow.id !== groceries, "copy must be a new recipient-owned row");

  const excluded = await api(owner, origin, own, "POST", "/v1/shared/exclusions", {
    postingId: fuel,
    audienceType: "group",
    audienceId: groupId,
    requestId: requestId(),
  });
  assert.equal(excluded.status(), 201);
  const narrowed = await (await api(second, origin, other, "GET", feedTarget)).json();
  assert.equal(narrowed.totals.count, 1, `narrowed totals = ${JSON.stringify(narrowed.totals)}`);

  const ungranted = await api(owner, origin, own, "DELETE", "/v1/shared/grants", {
    postingId: groceries,
    audienceType: "group",
    audienceId: groupId,
    requestId: requestId(),
  });
  assert.equal(ungranted.status(), 200);
  const disabled = await api(owner, origin, own, "PUT", `/v1/shared/policies/${groupId}`, {
    enabled: false,
    accountIds: [groupAccount],
    startDate: E2E_SEED.rangeStart,
    endDate: E2E_SEED.rangeEnd,
  });
  assert.equal(disabled.status(), 200);
  const denied = await api(second, origin, other, "GET", `/v1/shared/postings/${ownerResource}/${groceries}`);
  assert.equal(denied.status(), 404, "revoked read must deny without existence leakage");

  const memberModel = (await (await api(second, origin, other, "GET", "/v1/financial-model")).json()).model;
  assert.ok(
    memberModel.postings.some((row) => row.id === copyRow.id),
    "the granted copy must survive revocation as a private row",
  );
  console.log("e2e: group policy → feed → exclusion → revoke PASS");
}

// Receipt upload through the real storage path: multipart attach, metadata
// read, image bytes with the stored media type, listing, deletion, and
// cross-user denial on the same receipt id.
export async function receiptUpload(ctx, ownerBundle, secondBundle, pngPath) {
  const { origin } = ctx;
  const { owner, own } = ownerBundle;
  const { second, other } = secondBundle;
  const { readFile } = await import("node:fs/promises");
  const image = await readFile(pngPath);

  const postingId = await createPosting(ctx, ownerBundle, "E2E receipt purchase");
  const attached = await owner.request.post(`${origin}/v1/receipts`, {
    headers: { "Waypoint-Resource": own.resource.id },
    multipart: {
      postingId,
      image: { name: "market.png", mimeType: "image/png", buffer: image },
    },
  });
  assert.equal(attached.status(), 200, `attach receipt: ${await attached.text()}`);
  const receipt = (await attached.json()).receipt;
  assert.ok(receipt?.id, "attached receipt must carry an id");

  const listed = await (await api(owner, origin, own, "GET", `/v1/transactions/${postingId}/receipts`)).json();
  assert.ok(listed.receipts?.some((row) => row.id === receipt.id), "receipt must list under its posting");

  const pixels = await api(owner, origin, own, "GET", `/v1/receipts/${receipt.id}/image`);
  assert.equal(pixels.status(), 200);
  assert.match(pixels.headers()["content-type"] ?? "", /image\/(png|jpeg)/);
  assert.ok((await pixels.body()).length > 0, "stored image bytes must round-trip");

  const foreign = await api(second, origin, other, "GET", `/v1/receipts/${receipt.id}/image`);
  assert.equal(foreign.status(), 404, "cross-user receipt reads must deny without leakage");

  const deleted = await api(owner, origin, own, "DELETE", `/v1/receipts/${receipt.id}`);
  assert.equal(deleted.status(), 200);
  assert.equal((await api(owner, origin, own, "GET", `/v1/receipts/${receipt.id}/image`)).status(), 404);
  console.log("e2e: receipt upload, read, cross-user denial, delete PASS");
}

// All three principals share one physical database with row-level
// isolation; provider grants live beside financial rows.
export function sharedDatabaseIsolation(dbPath, { ownerSubject, guestSubject, secondSubject, issuer, guestResourceId }) {
  const shared = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const users = shared.prepare("SELECT user_id, id FROM accounts ORDER BY user_id, id").all();
    assert.equal(
      new Set(users.map((row) => row.user_id)).size,
      3,
      `owner, guest, and second user must share one database: ${JSON.stringify(users)}`,
    );
    const guestRow = userRowId(guestResourceId);
    assert.deepEqual(
      users.filter((row) => row.user_id === guestRow).map((row) => row.id),
      [E2E_SEED.accountId],
      "guest publication must land only the published rows in the guest scope",
    );
    assert.ok(
      shared.prepare("SELECT COUNT(*) AS n FROM identity_grants").get().n >= 2,
      "provider grants share the application database",
    );
    void ownerSubject;
    void guestSubject;
    void secondSubject;
    void issuer;
  } finally {
    shared.close();
  }
  console.log("e2e: shared-database isolation PASS");
}

// Logout removes private access; a captured cookie cannot restore it.
export async function ownerLogout(ctx, ownerBundle) {
  const { origin } = ctx;
  const { owner, own, cookie } = ownerBundle;
  assert.equal((await api(owner, origin, own, "POST", "/v1/auth/logout")).status(), 200);
  const replay = await fetch(`${origin}/v1/accounts`, {
    method: "POST",
    headers: {
      Cookie: `${cookie.name}=${cookie.value}`,
      "Waypoint-Resource": own.resource.id,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Captured cookie attempt", kind: "cash", enabled: true }),
  });
  assert.equal(replay.status, 401);
  const loggedOut = await session(owner, origin);
  assert.equal(loggedOut.authenticated, false);
  assert.equal(loggedOut.resource.id, actorResource(ctx.issuer, ctx.guestSubject));
  console.log("e2e: logout and captured-cookie rejection PASS");
}

// Extra deterministic data for edge exploration: one fixture pack plus
// tagged bulk rows, seeded into the owner after the isolation assertions.
// The exact guest and blank-workspace checks run before this step, so they
// stay byte-identical. Later journeys scope their own rows, so the extra
// data rides along without changing their assertions.
export async function seedExtraData(ctx, ownerBundle, { pack, bulk }) {
  const { origin } = ctx;
  const { owner, own } = ownerBundle;
  const packDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "backend", "testdata", "integration", "v1");

  const before = (await (await api(owner, origin, own, "GET", "/v1/financial-model")).json()).model;
  const haveAccounts = new Set(before.accounts.map((item) => item.id));
  let addedAccounts = 0;
  let addedPostings = 0;
  let addedRules = 0;

  async function createAccount(row) {
    if (haveAccounts.has(row.id)) return;
    const response = await api(owner, origin, own, "POST", "/v1/accounts", {
      id: row.id,
      name: row.name,
      kind: row.kind ?? "cash",
      enabled: row.enabled ?? true,
    });
    assert.equal(response.status(), 200, `seed account ${row.id}: ${await response.text()}`);
    assert.equal((await response.json()).saved, true);
    haveAccounts.add(row.id);
    addedAccounts += 1;
  }

  // The API path reproduces pack rows, so it passes the pack's own
  // resolver through instead of forcing one.
  function expressionAmount(amount) {
    return {
      resolver: amount?.resolver ?? "expression",
      config: amount?.config ?? { expression: "25.00" },
      inputs: amount?.inputs ?? {},
    };
  }

  // Deterministic version-5 UUID over one bulk coordinate, mirroring the
  // Go bulk builder's namespace-and-name scheme.
  function bulkPostingId(seed, account, index) {
    const namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
    const digest = createHash("sha1")
      .update(namespace)
      .update(`seed-bulk-${seed}-${account}-${index}`, "utf8")
      .digest();
    digest[6] = (digest[6] & 0x0f) | 0x50;
    digest[8] = (digest[8] & 0x3f) | 0x80;
    const hex = digest.subarray(0, 16).toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Deterministic spread matching the Go bulk day shapes: UTC midnight,
  // month edges, a leap day, and plain mid-month days.
  function bulkDay(next, index) {
    const day = 86400;
    switch (index % 8) {
      case 0:
        return Date.UTC(2026, 0, 1, 0, 0, 0) / 1000;
      case 1:
        return Date.UTC(2026, 0, 31, 23, 59, 59) / 1000;
      case 2:
        return Date.UTC(2024, 1, 29, 12, 0, 0) / 1000;
      case 3:
        return Date.UTC(2026, 11, 31, 23, 59, 59) / 1000;
      default:
        return Date.UTC(2026, 0, 1, 12, 0, 0) / 1000 + Math.floor(next() * 330) * day;
    }
  }

  // Seeded unit-interval stream, so bulk stays reproducible per seed.
  function seededStream(seed) {
    let state = Number(seed) | 0;
    if (state <= 0) state = -state + 1;
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  }

  async function createPosting(row) {
    const response = await api(owner, origin, own, "POST", "/v1/transactions", transactionPayload(row));
    assert.equal(response.status(), 200, `seed posting ${row.id}: ${await response.text()}`);
    assert.equal((await response.json()).saved, true);
    addedPostings += 1;
  }

  async function createRule(row) {
    const response = await api(owner, origin, own, "POST", "/v1/schedules", {
      id: row.id,
      name: row.name,
      sourceAccountId: row.sourceAccountId ?? null,
      destinations: row.destinations ?? [],
      amount: expressionAmount(row.amount),
      frequency: row.frequency ?? "monthly",
      startDate: row.startDate ?? "2026-01-01",
      enabled: row.enabled ?? true,
    });
    assert.equal(response.status(), 200, `seed rule ${row.id}: ${await response.text()}`);
    addedRules += 1;
  }

  if (pack) {
    const raw = await readFile(resolve(packDir, `${pack}.json`), "utf8").catch(() => {
      throw new Error(`unknown seed pack ${pack}`);
    });
    const model = JSON.parse(raw).model ?? {};
    // The API path covers accounts, checkpoints, postings, and rules. A
    // pack carrying evaluations, payment terms, or planned purchases needs
    // the Go import path instead, so fail loudly instead of half-seeding.
    const evaluations = model.evaluations ?? {};
    const hasEvaluations = Object.values(evaluations).some((rows) => (rows ?? []).length > 0);
    if (hasEvaluations || (model.paymentTerms ?? []).length > 0 || (model.plannedPurchases ?? []).length > 0) {
      throw new Error(`seed pack ${pack} needs the Go import path (unsupported sections present)`);
    }
    for (const account of model.accounts ?? []) await createAccount(account);
    for (const checkpoint of model.checkpoints ?? []) {
      const response = await api(owner, origin, own, "POST", "/v1/checkpoints", {
        accountId: checkpoint.AccountId ?? checkpoint.accountId,
        balance: checkpoint.Balance ?? checkpoint.balance,
        observedAt: checkpoint.observedAt,
      });
      assert.equal(response.status(), 200, `seed checkpoint: ${await response.text()}`);
    }
    for (const posting of model.postings ?? []) await createPosting(posting);
    for (const rule of model.schedules ?? []) await createRule(rule);
  }

  if (bulk) {
    const match = /^(\d+)x(\d+)(?::(-?\d+))?$/.exec(bulk.trim());
    assert.ok(match, `seed bulk ${bulk} wants NxM[:seed] like 20x200:7`);
    const accounts = Number(match[1]);
    const perAccount = Number(match[2]);
    const seed = Number(match[3] ?? 7);
    assert.ok(accounts >= 1 && accounts <= 100, "seed bulk accounts wants 1-100");
    assert.ok(perAccount >= 0 && perAccount <= 1000, "seed bulk postings wants 0-1000");
    assert.ok(accounts * perAccount <= 20000, "seed bulk exceeds 20000 postings");
    // Bulk tables mirror the Go bulk builder: the same amount and name
    // traits (including unicode, right-to-left, combining, and overlong
    // rows), the same day shapes, and the same account and rule ID scheme.
    // Limits mirror the Go caps; the Go builder owns them.
    const amounts = ["0.01", "0.005", "1500", "2.345", "19.99", "250.00", "42.50", "0.00"];
    const names = [
      "Seed coffee",
      "Caf\u00e9 \u2615 groceries",
      "Tokyo\u51fa\u5f35 lunch",
      "e\u0301 combining market",
      "\u0639\u0634\u0627\u0621 RTL dinner",
      "Seed fuel",
      "Seed rent",
      "Seed refund",
    ];
    const next = seededStream(seed);
    const day = 86400;
    for (let i = 0; i < accounts; i++) {
      const accountId = `seed-acct-${seed}-${String(i).padStart(4, "0")}`;
      let accountName = `${names[i % names.length]} ${String(i).padStart(2, "0")}`;
      if (i % 8 === 7) accountName = `${accountName} ${"\u00e9".repeat(40)}`;
      await createAccount({ id: accountId, name: accountName, kind: "cash", enabled: true });
      await api(owner, origin, own, "POST", "/v1/checkpoints", {
        accountId,
        balance: 1000 + Math.floor(next() * 9000),
        observedAt: Date.UTC(2026, 0, 1, 12, 0, 0) / 1000 + i * day,
      }).then(async (response) => {
        assert.equal(response.status(), 200, `seed checkpoint ${accountId}: ${await response.text()}`);
      });
      for (let j = 0; j < perAccount; j++) {
        const stamp = bulkDay(next, i + j);
        await createPosting({
          id: bulkPostingId(seed, i, j),
          name: `${names[(i + j) % names.length]} ${String(i).padStart(2, "0")}`,
          sourceAccountId: accountId,
          destinations: [],
          amount: { config: { expression: amounts[(i + j) % amounts.length] } },
          postedTime: stamp,
          transactionTime: stamp,
          enabled: true,
        });
      }
      if (i % 4 === 0) {
        await createRule({
          id: `seed-rule-${seed}-${String(i).padStart(4, "0")}`,
          name: `Seed rule ${String(i).padStart(2, "0")}`,
          sourceAccountId: accountId,
          destinations: [],
          amount: { config: { expression: "250.00" } },
          frequency: "monthly",
          startDate: "2026-01-01",
          enabled: true,
        });
      }
    }
  }

  const after = (await (await api(owner, origin, own, "GET", "/v1/financial-model")).json()).model;
  assert.equal(after.accounts.length - before.accounts.length, addedAccounts);
  assert.equal(after.postings.length - before.postings.length, addedPostings);
  console.log(
    `e2e: extra data seed pack=${pack ?? "none"} bulk=${bulk ?? "none"} ` +
      `(+${addedAccounts} accounts, +${addedPostings} postings, +${addedRules} rules) PASS`,
  );
}
