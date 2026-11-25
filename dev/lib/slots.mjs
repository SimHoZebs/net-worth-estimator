import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { defaultPorts, sanitizeSlot } from "../config.mjs";
import { root } from "./shell.mjs";

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

function probeLoopbackPort(port, host) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else if (error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL") resolve(true);
      else reject(error);
    });
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function portIsAvailable(port) {
  const [ipv4, ipv6] = await Promise.all([
    probeLoopbackPort(port, "127.0.0.1"),
    probeLoopbackPort(port, "::1"),
  ]);
  return ipv4 && ipv6;
}

export async function pickFreePorts(count, used = []) {
  const taken = new Set(used);
  const ports = [];
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const port = await freePort();
      if (port < 1024 || taken.has(port) || !(await portIsAvailable(port))) continue;
      taken.add(port);
      ports.push(port);
      break;
    }
  }
  if (ports.length !== count) throw new Error("Could not find free loopback ports");
  return ports;
}

export async function readOwner(stateDir) {
  try {
    return JSON.parse(await readFile(resolve(stateDir, "owner.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeOwner(stateDir, owner) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFile(resolve(stateDir, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function usedSlotPorts(excludeSlot = "", repoRoot = root) {
  const used = new Set([defaultPorts.app, defaultPorts.auth, defaultPorts.backend]);
  let tmpEntries = [];
  try {
    tmpEntries = await readdir(resolve(repoRoot, "tmp"));
  } catch {
    return used;
  }
  // Scan tmp/dev* owner files for ports claimed by other stacks.
  for (const name of tmpEntries) {
    if (name !== "dev" && !name.startsWith("dev-")) continue;
    let isDir = false;
    try {
      isDir = (await stat(resolve(repoRoot, "tmp", name))).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const slotName = name === "dev" ? "" : name.slice(4);
    if (slotName === sanitizeSlot(excludeSlot)) continue;
    const stateDir = resolve(repoRoot, `tmp/${name}`);
    const owner = await readOwner(stateDir);
    if (owner) {
      for (const url of [owner.appUrl, owner.authUrl]) {
        if (typeof url !== "string") continue;
        try {
          const port = Number(new URL(url).port);
          if (Number.isInteger(port) && port > 0) used.add(port);
        } catch {}
      }
      if (owner.ports && typeof owner.ports === "object") {
        for (const p of Object.values(owner.ports)) {
          const port = Number(p);
          if (Number.isInteger(port) && port > 0) used.add(port);
        }
      }
    }
    try {
      const config = JSON.parse(await readFile(resolve(stateDir, "config.json"), "utf8"));
      if (config.ports && typeof config.ports === "object") {
        for (const p of Object.values(config.ports)) {
          const port = Number(p);
          if (Number.isInteger(port) && port > 0) used.add(port);
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return used;
}
