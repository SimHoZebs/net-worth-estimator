import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, stat, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { brandingFields } from "./branding.mjs";
import {
  brandingTarget,
  brandingPlan,
  brandingUpdate,
  serializePlan,
  approvedPlan,
  digest,
  applyBranding,
} from "./apply-branding.mjs";

const target = brandingTarget({
  CASDOOR_PUBLIC_URL: "https://identity.example.test",
  AUTH_CLIENT_ID: "waypoint-test",
});
const plan = brandingPlan(target);

async function fixture(run, { sealed = true, bootstrap = {}, driver = "sqlite" } = {}) {
  const stateDir = await mkdtemp(resolve(tmpdir(), "casdoor-branding-"));
  const backupFile = resolve(stateDir, "previous-branding.json");
  await mkdir(resolve(stateDir, "conf"));
  await writeFile(
    resolve(stateDir, "conf/app.conf"),
    `driverName = ${driver}\ninitDataNewOnly = ${sealed}\ninitDataMerge = ${!sealed}\n`,
  );
  await writeFile(
    resolve(stateDir, "bootstrap.json"),
    JSON.stringify({ issuer: target.issuer, client_id: target.clientId, ...bootstrap }),
  );
  try {
    await run({ stateDir, backupFile, adminPassword: "administrator-credential" });
  } finally {
    for (const name of ["conf/app.conf", "bootstrap.json", "previous-branding.json"]) {
      await unlink(resolve(stateDir, name)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    await rmdir(resolve(stateDir, "conf"));
    await rmdir(stateDir);
  }
}

function service({
  override = {},
  accountOverride = {},
  mutate = (app) => app,
  rejectUpdate = false,
  version = { version: "v4.23.0", commitOffset: 0 },
  beforeUpdate = (app) => app,
} = {}) {
  let app = {
    owner: "admin",
    name: "waypoint",
    organization: "waypoint",
    clientId: target.clientId,
    clientSecret: "***",
    redirectUris: ["https://app.example.test/v1/auth/callback"],
    grantTypes: [
      "authorization_code",
      "refresh_token",
      "urn:ietf:params:oauth:grant-type:device_code",
    ],
    tokenSigningMethod: "RS256",
    cert: "existing-signing-key",
    expireInHours: 1,
    enableWebAuthn: true,
    signinItems: [{ name: "Username", visible: true }],
    ...override,
  };
  const calls = [];
  let reads = 0;
  let authenticated = false;
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path === "/api/get-version-info") {
      assert.equal(
        authenticated,
        true,
        "Pinned API filter requires admin login for version discovery",
      );
      return { data: version };
    }
    if (path === "/api/login" || path === "/api/logout") {
      authenticated = path === "/api/login";
      return { status: "ok" };
    }
    if (path === "/api/get-account")
      return { data: { owner: "built-in", name: "admin", isAdmin: true, ...accountOverride } };
    if (path.startsWith("/api/get-application?")) {
      if (++reads === 2) app = beforeUpdate(app);
      return { data: structuredClone(app) };
    }
    if (path.startsWith("/api/update-application?")) {
      const query = new URL(path, target.issuer).searchParams;
      assert.equal(query.get("id"), "admin/waypoint");
      assert.deepEqual(query.get("columns").split(","), brandingFields);
      // v4.23 uses MustCols, not an exclusive column filter. A sparse body is
      // essential: never send a stale full application, even with `columns`.
      assert.deepEqual(
        Object.keys(options.body).sort(),
        [...brandingFields, "name", "clientSecret"].sort(),
      );
      assert.equal(options.body.clientSecret, "***");
      if (rejectUpdate) return { data: "Unaffected" };
      app = mutate({
        ...app,
        ...Object.fromEntries(brandingFields.map((field) => [field, options.body[field]])),
      });
      return { data: "Affected" };
    }
    assert.fail(`Unexpected path: ${path}`);
  };
  return { request, calls, app: () => app };
}

test("preview has no credentials and requires an exact approved digest, source, and target", () => {
  const bytes = serializePlan(plan);
  assert.deepEqual(approvedPlan(bytes, digest(bytes), target), plan);
  assert.doesNotMatch(bytes, /clientSecret|adminPassword|userPassword/);
  assert.throws(() => approvedPlan(bytes, "", target), /digest/);
  assert.throws(() => approvedPlan(`${bytes} `, digest(bytes), target), /digest/);
  assert.throws(
    () => approvedPlan(bytes, digest(bytes), { ...target, clientId: "another-client" }),
    /source version and target/,
  );
  const extra = serializePlan({ ...plan, fields: { ...plan.fields, enableSignUp: false } });
  assert.throws(() => approvedPlan(extra, digest(extra), target), /source version and target/);
  assert.equal(
    brandingTarget({ CASDOOR_PUBLIC_URL: "http://identity.example.test", AUTH_CLIENT_ID: "id" })
      .issuer,
    "http://identity.example.test",
  );
  assert.throws(
    () => brandingTarget({ CASDOOR_PUBLIC_URL: target.issuer, AUTH_CLIENT_ID: "" }),
    /AUTH_CLIENT_ID/,
  );
  assert.throws(
    () => brandingPlan({ ...target, name: "app-built-in" }),
    /Unexpected branding target/,
  );
  assert.throws(
    () => brandingUpdate({ ...plan.fields, clientId: "another" }),
    /Unexpected presentation fields/,
  );
});

test("updates sparse presentation fields, preserves OIDC settings, backs up privately, and logs out", async () => {
  await fixture(async (options) => {
    const fake = service();
    assert.deepEqual(await applyBranding(plan, { ...options, request: fake.request }), {
      changed: true,
    });
    assert.equal(fake.app().cert, "existing-signing-key");
    assert.deepEqual(fake.app().grantTypes, [
      "authorization_code",
      "refresh_token",
      "urn:ietf:params:oauth:grant-type:device_code",
    ]);
    assert.equal(fake.app().enableWebAuthn, true);
    assert.equal(fake.app().title, "Waypoint account");
    const backup = await readFile(options.backupFile, "utf8");
    assert.doesNotMatch(backup, /credential|clientSecret|signing-key|redirectUris|signinItems/);
    assert.equal((await stat(options.backupFile)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(backup).fields.logo, null);
    assert.equal(fake.calls.at(-1).path, "/api/logout");
    const retry = service();
    await assert.rejects(
      () => applyBranding(plan, { ...options, request: retry.request }),
      /Backup path already exists/,
    );
    assert.equal(retry.calls.length, 0);
  });
});

test("checks the protected server version after admin login but before application updates", async () => {
  for (const version of [
    { version: "v4.24.0", commitOffset: 0 },
    { version: "v4.23.0", commitOffset: 1 },
    null,
  ]) {
    await fixture(async (options) => {
      const fake = service({ version });
      await assert.rejects(
        () => applyBranding(plan, { ...options, request: fake.request }),
        /requires unmodified Casdoor/,
      );
      assert.deepEqual(
        fake.calls.map((call) => call.path),
        ["/api/login", "/api/get-account", "/api/get-version-info", "/api/logout"],
      );
    });
  }
});

test("detects concurrent application changes before any update", async () => {
  await fixture(async (options) => {
    const fake = service({
      beforeUpdate: (app) => ({ ...app, redirectUris: ["https://new.example.test/callback"] }),
    });
    await assert.rejects(
      () => applyBranding(plan, { ...options, request: fake.request }),
      /changed during branding preparation/,
    );
    assert.equal(fake.calls.filter((call) => call.path.includes("update-")).length, 0);
    assert.equal(fake.calls.at(-1).path, "/api/logout");
    await stat(options.backupFile);
  });
});

test("rejects unsealed or mismatched state without any network request", async () => {
  for (const setup of [
    { sealed: false },
    { driver: "mysql" },
    { bootstrap: { issuer: "https://other.example.test" } },
    { bootstrap: { client_id: "other" } },
  ]) {
    await fixture(async (options) => {
      const fake = service();
      await assert.rejects(
        () => applyBranding(plan, { ...options, request: fake.request }),
        /sealed/,
      );
      assert.equal(fake.calls.length, 0);
    }, setup);
  }
});

test("refuses unexpected applications, custom forms, or non-admin accounts before any update", async () => {
  for (const setup of [
    { override: { clientId: "wrong" } },
    { override: { organization: "built-in" } },
    { override: { signinHtml: "<form></form>" } },
    { override: { signupHtml: "<form></form>" } },
    { accountOverride: { isAdmin: false } },
  ]) {
    await fixture(async (options) => {
      const fake = service(setup);
      await assert.rejects(
        () => applyBranding(plan, { ...options, request: fake.request }),
        /Unexpected|custom forms|administrator/,
      );
      assert.equal(fake.calls.filter((call) => call.path.includes("update-")).length, 0);
      assert.equal(fake.calls.at(-1).path, "/api/logout");
      await assert.rejects(() => stat(options.backupFile), { code: "ENOENT" });
    });
  }
});

test("is idempotent and verifies both branding and unchanged non-presentation fields", async () => {
  await fixture(async (options) => {
    const fake = service({ override: plan.fields });
    assert.deepEqual(await applyBranding(plan, { ...options, request: fake.request }), {
      changed: false,
    });
    assert.equal(fake.calls.filter((call) => call.path.includes("update-")).length, 0);
    await assert.rejects(() => stat(options.backupFile), { code: "ENOENT" });
  });
  for (const setup of [
    { mutate: (app) => ({ ...app, title: "not saved" }) },
    { mutate: (app) => ({ ...app, enableWebAuthn: false }) },
    { rejectUpdate: true },
  ]) {
    await fixture(async (options) => {
      const fake = service(setup);
      await assert.rejects(
        () => applyBranding(plan, { ...options, request: fake.request }),
        /verification failed|did not confirm/,
      );
      assert.equal(fake.calls.at(-1).path, "/api/logout");
      assert.equal(
        fake.calls.filter((call) => call.path.includes("update-")).length,
        1,
        "No automatic rollback",
      );
      await stat(options.backupFile);
    });
  }
});
