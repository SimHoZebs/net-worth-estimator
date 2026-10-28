// Preview is offline. Apply only adds missing objects from the exact approved file.
// Existing operator policies are never overwritten or deleted.
import { createHash } from "node:crypto";
import { readFile, writeFile, lstat } from "node:fs/promises";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPermissionSeed, permissionModelId } from "./permissions.mjs";
import { origin, defaultStateDir } from "./generate.mjs";
import { allowPrivateHTTP } from "./private-lan.mjs";
import { casdoorSession } from "./provision.mjs";

export function permissionTarget(env) {
  const issuer = origin(env.CASDOOR_PUBLIC_URL, "CASDOOR_PUBLIC_URL", allowPrivateHTTP(env));
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(env.AUTH_CLIENT_ID || "")) {
    throw new Error("AUTH_CLIENT_ID must contain 1–100 URL-safe characters");
  }
  return { issuer, organization: "waypoint", clientId: env.AUTH_CLIENT_ID };
}

export function permissionPlan(target) {
  if (
    !isDeepStrictEqual(
      target,
      permissionTarget({ CASDOOR_PUBLIC_URL: target?.issuer, AUTH_CLIENT_ID: target?.clientId }),
    )
  ) {
    throw new Error("Unexpected permission target");
  }
  return { version: 1, provider: "casdoor-v4.23.0", target, seed: buildPermissionSeed() };
}

export const permissionDigest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const serializePermissionPlan = (plan) => `${JSON.stringify(plan, null, 2)}\n`;

export function approvedPermissionPlan(bytes, sha256, target) {
  if (!/^[a-f0-9]{64}$/.test(sha256 || "") || permissionDigest(bytes) !== sha256) {
    throw new Error("Approval digest does not match the exact permission file");
  }
  const plan = JSON.parse(bytes);
  if (!isDeepStrictEqual(plan, permissionPlan(target))) {
    throw new Error(
      "Permission file does not match this source version and target. Preview again and obtain approval.",
    );
  }
  return plan;
}

function fields(object, template) {
  if (object === null) return null;
  if (!object || typeof object !== "object" || Array.isArray(object))
    throw new Error("Invalid Casdoor object response");
  return Object.fromEntries(Object.keys(template).map((key) => [key, object[key]]));
}

const objectTypes = Object.freeze({
  models: "model",
  roles: "role",
  adapters: "adapter",
  permissions: "permission",
});

export async function applyPermissions(
  plan,
  { stateDir, backupFile, adminPassword, request = casdoorSession(plan.target.issuer) },
) {
  if (
    !isDeepStrictEqual(plan, permissionPlan(plan.target)) ||
    !stateDir ||
    !backupFile ||
    !adminPassword
  ) {
    throw new Error(
      "Current permission plan, sealed state, explicit backup path, and administrator credential are required",
    );
  }
  const config = await readFile(resolve(stateDir, "conf/app.conf"), "utf8");
  const bootstrap = JSON.parse(await readFile(resolve(stateDir, "bootstrap.json"), "utf8"));
  if (
    !/^initDataNewOnly = true$/m.test(config) ||
    !/^initDataMerge = false$/m.test(config) ||
    bootstrap.issuer !== plan.target.issuer ||
    bootstrap.client_id !== plan.target.clientId
  ) {
    throw new Error("Expected sealed Casdoor state for this issuer and client. No requests sent.");
  }
  try {
    await lstat(backupFile);
    throw new Error(
      "Backup path already exists. Choose a new private backup path. No requests sent.",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const checked = async (path, options) => {
    const response = await request(path, options);
    if (response?.status !== "ok")
      throw new Error("Casdoor did not confirm the permission operation");
    return response.data;
  };
  await checked("/api/login", {
    method: "POST",
    body: {
      type: "login",
      signinMethod: "Password",
      organization: "built-in",
      application: "app-built-in",
      username: "admin",
      password: adminPassword,
    },
  });
  try {
    const account = await checked("/api/get-account");
    if (!account?.isAdmin || account.owner !== "built-in" || account.name !== "admin") {
      throw new Error("Expected the built-in administrator. No policy changes sent.");
    }
    // The v4.23 API filter protects version discovery. Authenticate first.
    const version = await checked("/api/get-version-info");
    if (version?.version !== "v4.23.0" || version.commitOffset !== 0) {
      throw new Error(
        "Permission apply requires unmodified Casdoor v4.23.0. No policy changes sent.",
      );
    }
    const app = await checked("/api/get-application?id=admin%2Fwaypoint");
    if (
      app?.owner !== "admin" ||
      app.name !== "waypoint" ||
      app.organization !== plan.target.organization ||
      app.clientId !== plan.target.clientId
    ) {
      throw new Error("Unexpected Casdoor application. No policy changes sent.");
    }
    const entries = Object.entries(objectTypes).flatMap(([plural, type]) =>
      plan.seed[plural].map((object) => ({
        plural,
        type,
        object,
        path: `/api/get-${type}?${new URLSearchParams({ id: `${object.owner}/${object.name}` })}`,
      })),
    );
    const knownPermissions = new Set(
      plan.seed.permissions.map(({ owner, name }) => `${owner}/${name}`),
    );
    const checkPermissionSet = async () => {
      const permissions = await checked("/api/get-permissions?owner=waypoint");
      if (
        !Array.isArray(permissions) ||
        permissions.some(
          (permission) =>
            permission?.model === permissionModelId &&
            !knownPermissions.has(`${permission.owner}/${permission.name}`),
        )
      ) {
        throw new Error(
          "The dedicated model has unexpected permissions. Review those policies separately. No further policy changes sent.",
        );
      }
    };
    await checkPermissionSet();
    const before = [];
    for (const entry of entries) {
      const snapshot = fields(await checked(entry.path), entry.object);
      if (snapshot !== null && !isDeepStrictEqual(snapshot, entry.object)) {
        throw new Error(
          `Existing ${entry.type} differs from the approved seed. No policy changes sent.`,
        );
      }
      before.push(snapshot);
    }
    if (before.every((object) => object !== null)) return { changed: false };
    // Only selected model/role/adapter/permission fields enter this private backup.
    // No client credentials, user records, sessions, or passkeys enter the file.
    await writeFile(
      backupFile,
      serializePermissionPlan({
        version: 1,
        target: plan.target,
        objects: entries.map(({ plural, object }, index) => ({
          type: plural,
          id: `${object.owner}/${object.name}`,
          before: before[index],
        })),
      }),
      { flag: "wx", mode: 0o600 },
    );
    await checkPermissionSet();
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (!isDeepStrictEqual(fields(await checked(entry.path), entry.object), before[index])) {
        throw new Error(
          "Policy objects changed during preparation. No further policy changes sent. Preserve the backup and inspect Casdoor.",
        );
      }
    }
    for (let index = 0; index < entries.length; index++) {
      if (before[index] !== null) continue;
      const entry = entries[index];
      // controllers/base.go wrapActionResponse returns "Affected", not true.
      if (
        (await checked(`/api/add-${entry.type}`, { method: "POST", body: entry.object })) !==
        "Affected"
      ) {
        throw new Error(
          "Casdoor did not confirm a policy object addition. Preserve the backup and inspect Casdoor before retrying.",
        );
      }
    }
    await checkPermissionSet();
    for (const entry of entries) {
      if (!isDeepStrictEqual(fields(await checked(entry.path), entry.object), entry.object)) {
        throw new Error(
          "Permission verification failed. Preserve the backup and inspect Casdoor. No automatic rollback was attempted.",
        );
      }
    }
    return { changed: true };
  } finally {
    await checked("/api/logout", { method: "POST" });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      preview: { type: "boolean" },
      apply: { type: "string" },
      sha256: { type: "string" },
      backup: { type: "string" },
    },
  });
  const target = permissionTarget(process.env);
  if (values.preview && !values.apply && !values.sha256 && !values.backup) {
    const bytes = serializePermissionPlan(permissionPlan(target));
    process.stdout.write(bytes);
    console.error(`Permissions SHA-256: ${permissionDigest(bytes)}`);
  } else if (values.apply && values.sha256 && values.backup && !values.preview) {
    const plan = approvedPermissionPlan(
      await readFile(values.apply, "utf8"),
      values.sha256,
      target,
    );
    const result = await applyPermissions(plan, {
      stateDir: process.env.CASDOOR_STATE_DIR || defaultStateDir,
      backupFile: resolve(values.backup),
      adminPassword: process.env.CASDOOR_ADMIN_PASSWORD,
    });
    console.log(
      result.changed
        ? "Added and verified the approved Casdoor authorization objects."
        : "Authorization objects already match. No policy objects changed.",
    );
  } else {
    throw new Error(
      "Use --preview, or --apply <approved.json> --sha256 <approved-digest> --backup <new-private-backup.json>",
    );
  }
}
