import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { settingsFromEnv } from "../auth/casdoor/generate.mjs";

export const project = "waypoint-dev";

export const defaultPorts = { app: 5178, casdoor: 8000, backend: 8788 };

export function sanitizeSlot(slot) {
  if (slot === undefined || slot === null || slot === "") return "";
  if (typeof slot !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(slot)) {
    throw new Error("Slot names use 1–32 lowercase letters, digits, - or _");
  }
  return slot;
}

export function projectFor(slot) {
  const clean = sanitizeSlot(slot);
  return clean ? `${project}-${clean}` : project;
}

export function stateDirFor(root, slot) {
  const clean = sanitizeSlot(slot);
  return resolve(root, clean ? `tmp/dev-${clean}` : "tmp/dev");
}

export function envFileFor(root, slot) {
  const clean = sanitizeSlot(slot);
  return resolve(root, clean ? `.env.dev.${clean}` : ".env.dev");
}

export function slotFromOptions(values) {
  return sanitizeSlot(values?.slot ?? process.env.DEV_SLOT ?? "");
}

function validPort(value, name) {
  const port = typeof value === "string" && value !== "" ? Number(value) : value;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be a loopback port from 1024 to 65535`);
  }
  return port;
}

function isLoopbackOrigin(value) {
  try {
    const url = new URL(value);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.protocol === "http:" &&
      url.port !== ""
    );
  } catch {
    return false;
  }
}

export function tailnetOrigins(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/.test(host)) {
    throw new Error("Tailnet HTTPS requires this node's full ts.net DNS name");
  }
  return { APP_PUBLIC_URL: `https://${host}:5178`, CASDOOR_PUBLIC_URL: `https://${host}:8000` };
}

export function originProfile(appUrl, issuerUrl) {
  if (isLoopbackOrigin(appUrl) && isLoopbackOrigin(issuerUrl)) {
    const appPort = Number(new URL(appUrl).port);
    const issuerPort = Number(new URL(issuerUrl).port);
    validPort(appPort, "App port");
    validPort(issuerPort, "Casdoor port");
    if (appPort === issuerPort) throw new Error("App and Casdoor loopback ports must differ");
    return null;
  }
  const app = new URL(appUrl);
  const expected = tailnetOrigins(app.hostname);
  if (appUrl !== expected.APP_PUBLIC_URL || issuerUrl !== expected.CASDOOR_PUBLIC_URL) {
    throw new Error(
      "Dev origins must use localhost HTTP or matching tailnet HTTPS on ports 5178/8000",
    );
  }
  return app.hostname;
}

export function newConfig(source = { container: "net-worth-estimator" }, hostname, options = {}) {
  const secret = () => randomBytes(24).toString("hex");
  const slot = sanitizeSlot(options.slot ?? "");
  const appPort = options.appPort ?? defaultPorts.app;
  const casdoorPort = options.casdoorPort ?? defaultPorts.casdoor;
  const backendPort = options.backendPort ?? defaultPorts.backend;
  if (hostname && (slot !== "" || appPort !== defaultPorts.app || casdoorPort !== defaultPorts.casdoor)) {
    throw new Error("Tailnet HTTPS stays on the canonical stack. Slots use loopback HTTP only.");
  }
  const app = hostname
    ? tailnetOrigins(hostname).APP_PUBLIC_URL
    : `http://localhost:${validPort(appPort, "App port")}`;
  const issuer = hostname
    ? tailnetOrigins(hostname).CASDOOR_PUBLIC_URL
    : `http://localhost:${validPort(casdoorPort, "Casdoor port")}`;
  validPort(backendPort, "Backend port");
  if (!hostname && app === issuer) throw new Error("App and Casdoor loopback ports must differ");
  return {
    version: 1,
    source,
    ownerSubject: null,
    slot,
    ports: {
      app: hostname ? defaultPorts.app : Number(new URL(app).port),
      casdoor: hostname ? defaultPorts.casdoor : Number(new URL(issuer).port),
      backend: Number(backendPort),
    },
    identity: {
      CASDOOR_PUBLIC_URL: issuer,
      APP_PUBLIC_URL: app,
      AUTH_CLIENT_ID: "waypoint-dev",
      AUTH_CLIENT_SECRET: secret(),
      CASDOOR_ADMIN_PASSWORD: secret(),
      CASDOOR_USER_NAME: "household",
      CASDOOR_USER_PASSWORD: secret(),
      CASDOOR_USER_DISPLAY_NAME: "Development owner",
      CASDOOR_BACKCHANNEL_LOGOUT_URL: "http://backend:8787/v1/auth/backchannel-logout",
      ...(hostname ? tailnetOrigins(hostname) : {}),
    },
  };
}

export function settings(config) {
  if (config.version !== 1) throw new Error("Unsupported dev configuration version");
  sanitizeSlot(config.slot ?? "");
  if (
    config.ownerSubject !== undefined &&
    config.ownerSubject !== null &&
    (typeof config.ownerSubject !== "string" ||
      !config.ownerSubject ||
      config.ownerSubject !== config.ownerSubject.trim() ||
      /[*,\r\n]/.test(config.ownerSubject))
  ) {
    throw new Error("The primary owner must be one verified OIDC subject");
  }
  if (
    !config.source ||
    (typeof config.source.file === "string") === (typeof config.source.container === "string")
  ) {
    throw new Error("Configure exactly one snapshot source: file or container");
  }
  if (
    (config.source.file !== undefined &&
      (typeof config.source.file !== "string" || !config.source.file.startsWith("/"))) ||
    (config.source.container !== undefined &&
      (typeof config.source.container !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(config.source.container)))
  ) {
    throw new Error("Snapshot sources require an absolute file path or a Docker container name");
  }
  const result = settingsFromEnv(config.identity);
  originProfile(result.appUrl, result.publicUrl);
  if (config.ports !== undefined) {
    if (typeof config.ports !== "object" || config.ports === null) {
      throw new Error("Dev ports must map app, casdoor, and backend to loopback ports");
    }
    const app = validPort(config.ports.app, "App port");
    const casdoor = validPort(config.ports.casdoor, "Casdoor port");
    const backend = validPort(config.ports.backend, "Backend port");
    if (app === casdoor) throw new Error("App and Casdoor loopback ports must differ");
    if (config.slot) {
      const parsedApp = isLoopbackOrigin(result.appUrl) ? Number(new URL(result.appUrl).port) : null;
      const parsedIssuer = isLoopbackOrigin(result.publicUrl)
        ? Number(new URL(result.publicUrl).port)
        : null;
      if (parsedApp !== app || parsedIssuer !== casdoor) {
        throw new Error("Slot ports must match the slot identity URLs");
      }
    }
  }
  return result;
}

export function portsFor(config) {
  if (config.ports) {
    return {
      app: validPort(config.ports.app, "App port"),
      casdoor: validPort(config.ports.casdoor, "Casdoor port"),
      backend: validPort(config.ports.backend, "Backend port"),
    };
  }
  if (isLoopbackOrigin(config.identity.APP_PUBLIC_URL) && isLoopbackOrigin(config.identity.CASDOOR_PUBLIC_URL)) {
    return {
      app: Number(new URL(config.identity.APP_PUBLIC_URL).port),
      casdoor: Number(new URL(config.identity.CASDOOR_PUBLIC_URL).port),
      backend: defaultPorts.backend,
    };
  }
  return { ...defaultPorts };
}

export function composeEnvironment(config) {
  settings(config);
  const ports = portsFor(config);
  return {
    DEV_UID: String(process.getuid()),
    DEV_GID: String(process.getgid()),
    DEV_PROJECT: projectFor(config.slot ?? ""),
    DEV_FRONTEND_PORT: String(ports.app),
    DEV_CASDOOR_PORT: String(ports.casdoor),
    DEV_BACKEND_DEBUG_PORT: String(ports.backend),
    DEV_APP_PUBLIC_URL: config.identity.APP_PUBLIC_URL,
    DEV_CASDOOR_PUBLIC_URL: config.identity.CASDOOR_PUBLIC_URL,
    DEV_AUTH_CLIENT_ID: config.identity.AUTH_CLIENT_ID,
    DEV_AUTH_CLIENT_SECRET: config.identity.AUTH_CLIENT_SECRET,
    DEV_OWNER_SUBJECT: config.ownerSubject ?? "",
  };
}

export async function writeComposeEnv(config, path, stateDir) {
  const env = composeEnvironment(config);
  if (stateDir) env.DEV_SLOT_STATE_DIR = stateDir;
  const slot = sanitizeSlot(config.slot ?? "");
  const configRef = slot ? `tmp/dev-${slot}/config.json` : "tmp/dev/config.json";
  const contents =
    `# Generated by scripts/dev setup from ${configRef}. Do not commit.\n` +
    Object.entries(env)
      .map(([name, value]) => `${name}='${value.replaceAll("'", "\\'")}'\n`)
      .join("");
  try {
    if ((await readFile(path, "utf8")) !== contents)
      throw new Error(
        `Existing ${path.split("/").pop()} differs from saved setup settings. Preserve it and reconcile the settings before setup.`,
      );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(path, contents, { mode: 0o600, flag: "wx" });
  }
}

export async function saveConfig(stateDir, config) {
  settings(config);
  const path = resolve(stateDir, "config.json");
  const temporary = `${path}.${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try {
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function loadConfig(stateDir, create, source, hostname, options = {}) {
  try {
    const config = JSON.parse(await readFile(resolve(stateDir, "config.json"), "utf8"));
    settings(config);
    if (hostname && config.identity.APP_PUBLIC_URL !== tailnetOrigins(hostname).APP_PUBLIC_URL) {
      throw new Error(
        "Existing dev identities use another origin. Preserve their state and migrate the registered URLs before changing profiles. See dev/README.md.",
      );
    }
    const wantSlot = sanitizeSlot(options.slot ?? config.slot ?? "");
    if (sanitizeSlot(config.slot ?? "") !== wantSlot) {
      throw new Error("Slot state belongs to another slot. Use its own --slot name.");
    }
    for (const key of ["appPort", "casdoorPort", "backendPort"]) {
      if (options[key] !== undefined) {
        const ports = portsFor(config);
        const current = key === "appPort" ? ports.app : key === "casdoorPort" ? ports.casdoor : ports.backend;
        if (Number(options[key]) !== current) {
          throw new Error(
            "Slot ports are fixed at creation. Delete the slot state or pick a new --slot name.",
          );
        }
      }
    }
    return config;
  } catch (error) {
    if (error.code !== "ENOENT" || !create) throw error;
  }
  const config = newConfig(source, hostname, options);
  await saveConfig(stateDir, config);
  return config;
}

// One short-lived lock protects bootstrap and financial/sample snapshots.
// Compose owns service processes. This file never acts as a process manager.
export async function withLock(stateDir, action) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const path = resolve(stateDir, "operation.lock");
  let lock;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      lock = await open(path, "wx", 0o600);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(await readFile(path, "utf8"));
      let stale = false;
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (probe) {
          stale = probe.code === "ESRCH";
        }
      }
      if (!stale) throw new Error("Another dev command is active.");
      await unlink(path);
    }
  }
  if (!lock) throw new Error("Could not acquire the dev operation lock");
  try {
    await lock.writeFile(String(process.pid));
    return await action();
  } finally {
    await lock.close();
    await unlink(path);
  }
}
