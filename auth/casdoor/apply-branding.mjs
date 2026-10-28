// Preview is offline. Only --apply with the approved file's digest contacts Casdoor.
import { createHash } from "node:crypto";
import { readFile, writeFile, lstat } from "node:fs/promises";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildBranding, brandingFields } from "./branding.mjs";
import { origin, defaultStateDir } from "./generate.mjs";
import { allowPrivateHTTP } from "./private-lan.mjs";
import { casdoorSession } from "./provision.mjs";

export function brandingTarget(env) {
  const issuer = origin(env.CASDOOR_PUBLIC_URL, "CASDOOR_PUBLIC_URL", allowPrivateHTTP(env));
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(env.AUTH_CLIENT_ID || "")) {
    throw new Error("AUTH_CLIENT_ID must contain 1–100 URL-safe characters");
  }
  return {
    issuer,
    owner: "admin",
    name: "waypoint",
    organization: "waypoint",
    clientId: env.AUTH_CLIENT_ID,
  };
}

export function brandingPlan(target) {
  if (
    !isDeepStrictEqual(
      target,
      brandingTarget({ CASDOOR_PUBLIC_URL: target?.issuer, AUTH_CLIENT_ID: target?.clientId }),
    )
  ) {
    throw new Error("Unexpected branding target");
  }
  return { version: 1, provider: "casdoor-v4.23.0", target, fields: buildBranding() };
}

export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const serializePlan = (plan) => `${JSON.stringify(plan, null, 2)}\n`;

export function approvedPlan(bytes, sha256, target) {
  if (!/^[a-f0-9]{64}$/.test(sha256 || "") || digest(bytes) !== sha256) {
    throw new Error("Approval digest does not match the exact branding file");
  }
  const plan = JSON.parse(bytes);
  if (!isDeepStrictEqual(plan, brandingPlan(target))) {
    throw new Error(
      "Branding file does not match this source version and target. Preview again and obtain approval.",
    );
  }
  return plan;
}

function presentation(application) {
  return Object.fromEntries(brandingFields.map((field) => [field, application[field] ?? null]));
}

function nonPresentation(application) {
  return Object.fromEntries(
    Object.entries(application).filter(([field]) => !brandingFields.includes(field)),
  );
}

function checkApplication(application, target) {
  if (
    !application ||
    !["owner", "name", "organization", "clientId"].every((key) => application[key] === target[key])
  ) {
    throw new Error("Unexpected Casdoor application. No branding changes sent.");
  }
  if (application.signinHtml || application.signupHtml) {
    throw new Error("Existing custom forms require a separate review. No branding changes sent.");
  }
}

export function brandingUpdate(fields) {
  if (!isDeepStrictEqual(fields, buildBranding()))
    throw new Error("Unexpected presentation fields");
  // v4.23 UpdateApplication uses Xorm MustCols, not Cols. MustCols includes
  // zero values but does NOT restrict updates to those columns. Send no stale
  // full application or repeated clientId/organization. Casdoor sets owner from
  // the URL. name prevents its rename path. "***" makes it omit client_secret.
  return { name: "waypoint", clientSecret: "***", ...fields };
}

export async function applyBranding(
  plan,
  { stateDir, backupFile, adminPassword, request = casdoorSession(plan.target.issuer) },
) {
  // Also check programmatic callers, before any local write or network request.
  if (!isDeepStrictEqual(plan, brandingPlan(plan.target)) || !backupFile || !adminPassword) {
    throw new Error(
      "Current branding plan, explicit backup path, and administrator credential are required",
    );
  }
  const config = await readFile(resolve(stateDir, "conf/app.conf"), "utf8");
  const bootstrap = JSON.parse(await readFile(resolve(stateDir, "bootstrap.json"), "utf8"));
  if (
    !/^driverName = sqlite$/m.test(config) ||
    !/^initDataNewOnly = true$/m.test(config) ||
    !/^initDataMerge = false$/m.test(config) ||
    bootstrap.issuer !== plan.target.issuer ||
    bootstrap.client_id !== plan.target.clientId
  ) {
    throw new Error(
      "Expected sealed SQLite Casdoor state for this issuer and client. No requests sent.",
    );
  }
  try {
    await lstat(backupFile);
    throw new Error(
      "Backup path already exists. Choose a new private backup path. No requests sent.",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await request("/api/login", {
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
    const account = (await request("/api/get-account")).data;
    if (!account?.isAdmin || account.owner !== "built-in" || account.name !== "admin") {
      throw new Error("Expected the built-in administrator. No branding changes sent.");
    }
    // The v4.23 API filter restricts version discovery to authenticated admins.
    const version = (await request("/api/get-version-info")).data;
    if (version?.version !== "v4.23.0" || version.commitOffset !== 0) {
      throw new Error(
        "Branding apply requires unmodified Casdoor v4.23.0. No branding changes sent.",
      );
    }
    const query = new URLSearchParams({ id: "admin/waypoint" });
    const path = `/api/get-application?${query}`;
    const before = (await request(path)).data;
    checkApplication(before, plan.target);
    if (isDeepStrictEqual(presentation(before), plan.fields)) return { changed: false };

    // No client secrets, passwords, users, passkeys, or config enter this backup.
    await writeFile(
      backupFile,
      serializePlan({ version: 1, target: plan.target, fields: presentation(before) }),
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    const current = (await request(path)).data;
    if (!isDeepStrictEqual(current, before)) {
      throw new Error(
        "Application changed during branding preparation. No branding changes sent. Obtain a new snapshot before retrying.",
      );
    }
    query.set("columns", brandingFields.join(","));
    const updated = await request(`/api/update-application?${query}`, {
      method: "POST",
      body: brandingUpdate(plan.fields),
    });
    if (updated.data !== "Affected")
      throw new Error(
        "Casdoor did not confirm a branding update. Inspect the application before retrying.",
      );
    const after = (await request(path)).data;
    if (
      !isDeepStrictEqual(presentation(after), plan.fields) ||
      !isDeepStrictEqual(nonPresentation(after), nonPresentation(before))
    ) {
      throw new Error(
        "Branding verification failed. Preserve the backup and inspect Casdoor. No automatic rollback was attempted.",
      );
    }
    return { changed: true };
  } finally {
    await request("/api/logout", { method: "POST" });
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
  const target = brandingTarget(process.env);
  if (values.preview && !values.apply && !values.sha256 && !values.backup) {
    const bytes = serializePlan(brandingPlan(target));
    process.stdout.write(bytes);
    console.error(`Branding SHA-256: ${digest(bytes)}`);
  } else if (values.apply && values.sha256 && values.backup && !values.preview) {
    const plan = approvedPlan(await readFile(values.apply, "utf8"), values.sha256, target);
    const result = await applyBranding(plan, {
      stateDir: process.env.CASDOOR_STATE_DIR || defaultStateDir,
      backupFile: resolve(values.backup),
      adminPassword: process.env.CASDOOR_ADMIN_PASSWORD,
    });
    console.log(
      result.changed
        ? "Applied and verified Waypoint presentation fields only."
        : "Waypoint branding already matches. No application update sent.",
    );
  } else {
    throw new Error(
      "Use --preview, or --apply <approved.json> --sha256 <approved-digest> --backup <new-private-backup.json>",
    );
  }
}
