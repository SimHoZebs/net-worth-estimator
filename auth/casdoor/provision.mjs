import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { settingsFromEnv, defaultStateDir } from "./generate.mjs";

export function casdoorSession(baseUrl) {
  const cookies = new Map();
  return async (path, { method = "GET", body, redirect = "error", form, headers = {} } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      redirect,
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...(form
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : body
            ? { "Content-Type": "application/json" }
            : {}),
        ...(cookies.size
          ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") }
          : {}),
        ...headers,
      },
      ...(form
        ? { body: new URLSearchParams(form) }
        : body === undefined
          ? {}
          : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const result = await response.json();
    if (!response.ok || result.status === "error") {
      // Do not include response bodies: upstream diagnostics can contain credentials.
      throw new Error(
        `Casdoor request failed: ${method} ${path.split("?")[0]} (${response.status})`,
      );
    }
    return result;
  };
}

export async function provision(settings) {
  const request = casdoorSession(settings.publicUrl);
  await request("/api/login", {
    method: "POST",
    body: {
      type: "login",
      signinMethod: "Password",
      application: "waypoint",
      organization: "waypoint",
      username: settings.username,
      password: settings.password,
    },
  });
  try {
    const account = await request("/api/get-account");
    if (account.data?.isAdmin || account.data?.owner !== "waypoint") {
      throw new Error("Unexpected bootstrap account");
    }
    if (
      !account.sub ||
      account.sub !== account.data.id ||
      account.data.name !== settings.username
    ) {
      throw new Error("Bootstrap identity has inconsistent subject claims");
    }
    // The provisioned guest is a normal account whose UUID Casdoor generates
    // at seed import (init_data overwrites seed IDs). Discover it by name and
    // persist the actual subject; never mint a replacement identity here, so
    // interrupted runs and retries resolve the same guest.
    //
    // Discovery uses the application's BasicAuth credentials on a fresh,
    // cookie-free session — not the owner's login session. With
    // isProfilePublic=false the provider denies cross-user profile reads to
    // ordinary sessions; the app credential is the documented
    // machine-to-machine path (same as batch-enforce), not an admin login.
    if (!settings.clientId || !settings.clientSecret) {
      throw new Error("Application credentials are required for guest discovery");
    }
    const appRequest = casdoorSession(settings.publicUrl);
    const guest = (
      await appRequest(`/api/get-user?id=${encodeURIComponent(`waypoint/${settings.guestName}`)}`, {
        headers: {
          Authorization: `Basic ${btoa(`${settings.clientId}:${settings.clientSecret}`)}`,
        },
      })
    ).data;
    if (
      !guest ||
      typeof guest.id !== "string" ||
      !guest.id ||
      guest.owner !== "waypoint" ||
      guest.name !== settings.guestName
    ) {
      throw new Error(
        "Provisioned guest account is missing or misnamed. Reinitialize or create it before sealing.",
      );
    }
    if (guest.isAdmin || guest.isForbidden || guest.isDeleted) {
      throw new Error("Provisioned guest account must be an ordinary active user");
    }
    if (guest.id === account.sub) {
      throw new Error("Provisioned guest account must differ from the bootstrap owner");
    }
    return {
      version: 1,
      issuer: settings.publicUrl,
      client_id: settings.clientId,
      redirect_uri: `${settings.appUrl}/v1/auth/callback`,
      username: settings.username,
      subject: account.sub,
      guest_subject: guest.id,
    };
  } finally {
    await request("/api/logout", { method: "POST" });
  }
}

export async function writeBootstrap(settings, stateDir) {
  const path = resolve(stateDir, "bootstrap.json");
  try {
    await stat(path);
    throw new Error("Bootstrap metadata already exists. Keep it for restarts.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // The first merge disables built-in public signup. Future starts must not
  // reapply seed profile data or replace operator-managed application settings.
  const configPath = resolve(stateDir, "conf/app.conf");
  const config = await readFile(configPath, "utf8");
  const metadata = await provision(settings);
  const sealed = config
    .replace(/^initDataNewOnly = false$/m, "initDataNewOnly = true")
    .replace(/^initDataMerge = true$/m, "initDataMerge = false");
  if (!/^initDataNewOnly = true$/m.test(sealed) || !/^initDataMerge = false$/m.test(sealed)) {
    throw new Error("Cannot seal unknown Casdoor import settings");
  }
  // Seal atomically before recording success. A failed write can be retried
  // with provision.mjs, even if the configuration was already sealed.
  const temporary = `${configPath}.${randomUUID()}`;
  try {
    await writeFile(temporary, sealed, { mode: 0o600, flag: "wx" });
    await rename(temporary, configPath);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await writeBootstrap(
    settingsFromEnv(process.env),
    process.env.CASDOOR_STATE_DIR || defaultStateDir,
  );
  console.log(
    "Verified the generated non-admin subject. Private metadata is in the state directory bootstrap.json.",
  );
}
