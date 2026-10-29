import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, stat, unlink, rmdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { permissionModelId } from "./permissions.mjs";
import {
  permissionTarget,
  permissionPlan,
  permissionDigest,
  serializePermissionPlan,
  approvedPermissionPlan,
  applyPermissions,
} from "./apply-permissions.mjs";

const target = permissionTarget({
  CASDOOR_PUBLIC_URL: "https://identity.example.test",
  AUTH_CLIENT_ID: "waypoint-test",
});
const plan = permissionPlan(target);

async function fixture(run, { sealed = true, bootstrap = {} } = {}) {
  const stateDir = await mkdtemp("/tmp/opencode/casdoor-permissions-");
  const backupFile = resolve(stateDir, "previous-permissions.json");
  await mkdir(resolve(stateDir, "conf"));
  await writeFile(
    resolve(stateDir, "conf/app.conf"),
    `initDataNewOnly = ${sealed}\ninitDataMerge = ${!sealed}\n`,
  );
  await writeFile(
    resolve(stateDir, "bootstrap.json"),
    JSON.stringify({ issuer: target.issuer, client_id: target.clientId, ...bootstrap }),
  );
  try {
    await run({ stateDir, backupFile, adminPassword: "administrator-credential" });
  } finally {
    for (const name of ["conf/app.conf", "bootstrap.json", "previous-permissions.json"]) {
      await unlink(resolve(stateDir, name)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    await rmdir(resolve(stateDir, "conf"));
    await rmdir(stateDir);
  }
}

function service({
  existing = [],
  account = {},
  app = {},
  version = { version: "v4.23.0", commitOffset: 0 },
  extraPermission,
  beforeRead = () => {},
  afterAdd = (object) => object,
  addResult = "Affected",
} = {}) {
  const objects = new Map(
    existing.map((object) => [`${object.owner}/${object.name}`, structuredClone(object)]),
  );
  const calls = [];
  const reads = new Map();
  let authenticated = false;
  const ok = (data) => ({ status: "ok", data: structuredClone(data) });
  const request = async (path, options = {}) => {
    calls.push({ path, ...structuredClone(options) });
    if (path === "/api/login" || path === "/api/logout") {
      authenticated = path === "/api/login";
      return ok(null);
    }
    assert.equal(authenticated, true, "All protected operations require administrator login");
    if (path === "/api/get-account")
      return ok({ owner: "built-in", name: "admin", isAdmin: true, ...account });
    if (path === "/api/get-version-info") return ok(version);
    if (path.startsWith("/api/get-application?"))
      return ok({
        owner: "admin",
        name: "waypoint",
        organization: "waypoint",
        clientId: target.clientId,
        ...app,
      });
    if (path.startsWith("/api/get-permissions?"))
      return ok([
        ...[...objects.values()].filter((object) => object.model),
        ...(extraPermission ? [extraPermission] : []),
      ]);
    const url = new URL(path, target.issuer);
    if (/^\/api\/get-(model|role|adapter|permission)$/.test(url.pathname)) {
      const id = url.searchParams.get("id");
      reads.set(id, (reads.get(id) || 0) + 1);
      beforeRead(id, reads.get(id), objects);
      return ok(objects.get(id) || null);
    }
    if (/^\/api\/add-(model|role|adapter|permission)$/.test(url.pathname)) {
      assert.equal(options.method, "POST");
      const object = structuredClone(options.body);
      const id = `${object.owner}/${object.name}`;
      assert.equal(objects.has(id), false, "Never overwrite an existing object");
      if (addResult === "Affected") objects.set(id, afterAdd(object));
      return ok(addResult);
    }
    assert.fail(`Unexpected API path: ${path}`);
  };
  return { request, calls, objects };
}

const seedObjects = Object.values(plan.seed).flat();
const mutations = (fake) =>
  fake.calls.filter(({ path }) => /\/api\/(add|update|delete)-/.test(path));

test("offline preview pins exact artifact bytes, target, source version, and digest", () => {
  const bytes = serializePermissionPlan(plan);
  assert.deepEqual(approvedPermissionPlan(bytes, permissionDigest(bytes), target), plan);
  assert.doesNotMatch(bytes, /clientSecret|adminPassword|administrator-credential/);
  assert.throws(() => approvedPermissionPlan(bytes, "", target), /digest/);
  assert.throws(
    () => approvedPermissionPlan(`${bytes} `, permissionDigest(bytes), target),
    /digest/,
  );
  assert.throws(
    () =>
      approvedPermissionPlan(bytes, permissionDigest(bytes), { ...target, clientId: "another" }),
    /source version and target/,
  );
  const modified = structuredClone(plan);
  modified.seed.permissions[1].actions.push("account:write");
  const modifiedBytes = serializePermissionPlan(modified);
  assert.throws(
    () => approvedPermissionPlan(modifiedBytes, permissionDigest(modifiedBytes), target),
    /source version and target/,
  );
  assert.equal(
    permissionTarget({
      CASDOOR_PUBLIC_URL: "http://identity.example.test",
      AUTH_CLIENT_ID: "id",
      NET_WORTH_ESTIMATOR_ALLOW_PRIVATE_HTTP: "1",
    }).issuer,
    "http://identity.example.test",
  );
  assert.throws(
    () => permissionPlan({ ...target, organization: "built-in" }),
    /Unexpected permission target/,
  );
  const preview = spawnSync(process.execPath, ["auth/casdoor/apply-permissions.mjs", "--preview"], {
    encoding: "utf8",
    env: { ...process.env, CASDOOR_PUBLIC_URL: target.issuer, AUTH_CLIENT_ID: target.clientId },
  });
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(preview.stdout, bytes);
  assert.match(preview.stderr, new RegExp(permissionDigest(bytes)));
});

test("adds only the exact approved objects in dependency order and creates a private backup", async () => {
  await fixture(async (options) => {
    const fake = service();
    assert.deepEqual(await applyPermissions(plan, { ...options, request: fake.request }), {
      changed: true,
    });
    assert.deepEqual(
      mutations(fake).map(({ path }) => path),
      [
        "/api/add-model",
        "/api/add-role",
        "/api/add-role",
        "/api/add-adapter",
        "/api/add-permission",
        "/api/add-permission",
      ],
    );
    assert.deepEqual(
      mutations(fake).map(({ body }) => body),
      [...plan.seed.models, ...plan.seed.roles, ...plan.seed.adapters, ...plan.seed.permissions],
    );
    assert.equal(fake.calls.at(-1).path, "/api/logout");
    const backup = await readFile(options.backupFile, "utf8");
    assert.doesNotMatch(backup, /credential|clientSecret|password|passkey/);
    assert.equal((await stat(options.backupFile)).mode & 0o777, 0o600);
    assert.ok(JSON.parse(backup).objects.every(({ before }) => before === null));
    const retry = service();
    await assert.rejects(
      () => applyPermissions(plan, { ...options, request: retry.request }),
      /Backup path already exists/,
    );
    assert.equal(retry.calls.length, 0);
  });
});

test("idempotent existing objects cause no writes and partial seeds add only missing objects", async () => {
  await fixture(async (options) => {
    const fake = service({
      existing: seedObjects.map((object) => ({ ...object, createdTime: "provider-time" })),
    });
    assert.deepEqual(await applyPermissions(plan, { ...options, request: fake.request }), {
      changed: false,
    });
    assert.equal(mutations(fake).length, 0);
    await assert.rejects(() => stat(options.backupFile), { code: "ENOENT" });
  });
  await fixture(async (options) => {
    const fake = service({
      existing: [...plan.seed.models, ...plan.seed.roles, ...plan.seed.adapters],
    });
    assert.deepEqual(await applyPermissions(plan, { ...options, request: fake.request }), {
      changed: true,
    });
    assert.deepEqual(
      mutations(fake).map(({ path }) => path),
      ["/api/add-permission", "/api/add-permission"],
    );
  });
});

test("rejects unsealed, mismatched, or unapproved content before any network request", async () => {
  for (const setup of [
    { sealed: false },
    { bootstrap: { issuer: "https://other.example.test" } },
    { bootstrap: { client_id: "other" } },
  ]) {
    await fixture(async (options) => {
      const fake = service();
      await assert.rejects(
        () => applyPermissions(plan, { ...options, request: fake.request }),
        /sealed/,
      );
      assert.equal(fake.calls.length, 0);
    }, setup);
  }
  await fixture(async (options) => {
    const fake = service();
    const changed = structuredClone(plan);
    changed.seed.permissions[0].effect = "Deny";
    await assert.rejects(
      () => applyPermissions(changed, { ...options, request: fake.request }),
      /Current permission plan/,
    );
    assert.equal(fake.calls.length, 0);
  });
});

test("validates protected provider version, administrator, and target application before policy writes", async () => {
  for (const setup of [
    { version: { version: "v4.24.0", commitOffset: 0 } },
    { version: { version: "v4.23.0", commitOffset: 1 } },
    { account: { isAdmin: false } },
    { app: { clientId: "another" } },
    { app: { organization: "built-in" } },
  ]) {
    await fixture(async (options) => {
      const fake = service(setup);
      await assert.rejects(
        () => applyPermissions(plan, { ...options, request: fake.request }),
        /requires unmodified|administrator|Unexpected Casdoor application/,
      );
      assert.equal(mutations(fake).length, 0);
      assert.equal(fake.calls.at(-1).path, "/api/logout");
      await assert.rejects(() => stat(options.backupFile), { code: "ENOENT" });
    });
  }
});

test("refuses operator policy drift and extra model permissions without overwriting them", async () => {
  for (const setup of [
    { existing: [{ ...plan.seed.roles[0], users: ["user:existing-role-member"] }] },
    { existing: [{ ...plan.seed.models[0], modelText: "operator model" }] },
    { extraPermission: { owner: "waypoint", name: "additional-grant", model: permissionModelId } },
  ]) {
    await fixture(async (options) => {
      const fake = service(setup);
      await assert.rejects(
        () => applyPermissions(plan, { ...options, request: fake.request }),
        /differs|unexpected permissions/,
      );
      assert.equal(mutations(fake).length, 0);
      assert.equal(fake.calls.at(-1).path, "/api/logout");
      await assert.rejects(() => stat(options.backupFile), { code: "ENOENT" });
    });
  }
});

test("detects preparation races before policy writes and keeps the backup", async () => {
  await fixture(async (options) => {
    const fake = service({
      beforeRead: (id, reads, objects) => {
        if (id === permissionModelId && reads === 2)
          objects.set(id, { ...plan.seed.models[0], modelText: "concurrent model edit" });
      },
    });
    await assert.rejects(
      () => applyPermissions(plan, { ...options, request: fake.request }),
      /changed during preparation/,
    );
    assert.equal(mutations(fake).length, 0);
    await stat(options.backupFile);
  });
});

test("rejects unsupported write responses and post-write mismatch without automatic rollback", async () => {
  for (const setup of [
    { addResult: true },
    { addResult: "Unaffected" },
    { afterAdd: (object) => ({ ...object, displayName: "not saved" }) },
  ]) {
    await fixture(async (options) => {
      const fake = service(setup);
      await assert.rejects(
        () => applyPermissions(plan, { ...options, request: fake.request }),
        /did not confirm|verification failed/,
      );
      assert.ok(mutations(fake).every(({ path }) => path.startsWith("/api/add-")));
      assert.equal(fake.calls.at(-1).path, "/api/logout");
      await stat(options.backupFile);
    });
  }
});
