import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { generate } from "../auth/casdoor/generate.mjs";
import { writeBootstrap } from "../auth/casdoor/provision.mjs";
import { databaseName, validateSnapshot } from "./database.mjs";
import {
  envFileFor,
  loadConfig,
  originProfile,
  portsFor,
  projectFor,
  saveConfig,
  settings,
  slotFromOptions,
  stateDirFor,
  withLock,
  writeComposeEnv,
} from "./config.mjs";
import { checkServe, nodeHostname } from "./tailnet.mjs";
import { devOptions } from "./lib/args.mjs";
import { compose, composeCommandFor } from "./lib/compose.mjs";
import { runIfCli } from "./lib/entry.mjs";
import { exists, root, run as runCommand } from "./lib/shell.mjs";
import { pickFreePorts, usedSlotPorts, writeOwner } from "./lib/slots.mjs";
import { snapshot } from "./lib/snapshot.mjs";

const canonicalStateDir = stateDirFor(root, "");

export function parseSetupArgs(args) {
  return parseArgs({ args, allowPositionals: true, options: devOptions });
}

export function validateSetup(values, positionals = []) {
  if (positionals.length > 0) throw new Error("Unexpected dev arguments. Use scripts/dev --help.");
  const slot = slotFromOptions(values);
  if (values.user)
    throw new Error(
      "--user applies only to refresh-db; setup binds a user to its verified dev identity",
    );
  if (
    (values["app-port"] !== undefined ||
      values["casdoor-port"] !== undefined ||
      values["backend-port"] !== undefined) &&
    slot === ""
  ) {
    throw new Error("Canonical ports are fixed at 5178/8000/8788. Use --slot for custom ports.");
  }
  if (values.tailnet && slot !== "")
    throw new Error("--tailnet applies only to the canonical stack");
}

export async function resolveSetupScope(values) {
  const slot = slotFromOptions(values);
  const stateDir = stateDirFor(root, slot);
  const envFile = envFileFor(root, slot);
  let source = values.from ? { file: resolve(values.from) } : undefined;
  const explicitPorts = {
    appPort: values["app-port"],
    casdoorPort: values["casdoor-port"],
    backendPort: values["backend-port"],
  };
  const wantsExplicitPorts =
    explicitPorts.appPort !== undefined ||
    explicitPorts.casdoorPort !== undefined ||
    explicitPorts.backendPort !== undefined;
  // Resolve ports before the lock so validation failures leave no empty state dir.
  let slotOptions = { slot };
  if (slot !== "" && !(await exists(resolve(stateDir, "config.json")))) {
    const used = await usedSlotPorts(slot);
    const parsePort = (raw, name) => {
      if (raw === undefined) return undefined;
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error(`${name} must be a loopback port from 1024 to 65535`);
      }
      if (used.has(port)) throw new Error(`${name} ${port} is already used by another dev stack`);
      return port;
    };
    let appPort = parsePort(explicitPorts.appPort, "--app-port");
    let casdoorPort = parsePort(explicitPorts.casdoorPort, "--casdoor-port");
    let backendPort = parsePort(explicitPorts.backendPort, "--backend-port");
    const missing =
      (appPort === undefined ? 1 : 0) +
      (casdoorPort === undefined ? 1 : 0) +
      (backendPort === undefined ? 1 : 0);
    if (missing > 0) {
      const free = await pickFreePorts(missing, [...used]);
      let cursor = 0;
      if (appPort === undefined) appPort = free[cursor++];
      if (casdoorPort === undefined) casdoorPort = free[cursor++];
      if (backendPort === undefined) backendPort = free[cursor++];
    }
    if (appPort === casdoorPort) throw new Error("App and Casdoor slot ports must differ");
    slotOptions = { slot, appPort, casdoorPort, backendPort };
    // Clone the canonical database when the slot has no explicit source.
    if (!source) {
      const canonicalDb = resolve(canonicalStateDir, "data", databaseName);
      if (await exists(canonicalDb)) source = { file: canonicalDb };
    }
  } else if (wantsExplicitPorts) {
    slotOptions = {
      slot,
      appPort: explicitPorts.appPort === undefined ? undefined : Number(explicitPorts.appPort),
      casdoorPort:
        explicitPorts.casdoorPort === undefined ? undefined : Number(explicitPorts.casdoorPort),
      backendPort:
        explicitPorts.backendPort === undefined ? undefined : Number(explicitPorts.backendPort),
    };
  }
  return { slot, stateDir, envFile, source, slotOptions };
}

async function setupFlow(config, sourceUser, { stateDir, envFile, slot }) {
  if (originProfile(config.identity.APP_PUBLIC_URL, config.identity.CASDOOR_PUBLIC_URL)) {
    checkServe(
      config,
      JSON.parse(runCommand("tailscale", ["status", "--json"], { capture: true })),
      JSON.parse(runCommand("tailscale", ["serve", "status", "--json"], { capture: true })),
    );
  }
  const identityDir = resolve(stateDir, "casdoor");
  if (!(await exists(resolve(identityDir, "conf/app.conf"))))
    await generate(settings(config), identityDir);
  const destination = resolve(stateDir, "data", databaseName);
  const fresh = !(await exists(destination));
  if (!fresh && validateSnapshot(destination) !== "application") {
    throw new Error(
      "Existing dev database is a legacy format without migration support. Back it up, delete it, and run setup again.",
    );
  }
  const bootstrapPath = resolve(identityDir, "bootstrap.json");
  if (!(await exists(bootstrapPath))) {
    compose(config, ["up", "-d", "--wait", "casdoor"]);
    await writeBootstrap(settings(config), identityDir);
  }
  const bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8"));
  if (
    bootstrap.issuer !== config.identity.CASDOOR_PUBLIC_URL ||
    bootstrap.client_id !== config.identity.AUTH_CLIENT_ID ||
    bootstrap.redirect_uri !== `${config.identity.APP_PUBLIC_URL}/v1/auth/callback` ||
    bootstrap.username !== config.identity.CASDOOR_USER_NAME
  ) {
    throw new Error("Dev identity metadata does not match its saved configuration");
  }
  if (config.ownerSubject === null) {
    config.ownerSubject = bootstrap.subject;
    await saveConfig(stateDir, config);
  }
  if (!config.ownerSubject)
    throw new Error(
      `Set the verified Bridge ownerSubject in ${slot ? `tmp/dev-${slot}` : "tmp/dev"}/config.json. User ownership comes from the application database.`,
    );
  if (fresh) {
    const incoming = await snapshot(config, stateDir);
    if (validateSnapshot(incoming) !== "application")
      throw new Error(
        `Legacy snapshot saved at ${incoming} has no migration path. Use a current application database instead.`,
      );
    const helper = resolve(stateDir, "refreshplan");
    runCommand("go", ["-C", "backend", "build", "-o", helper, "./cmd/refreshplan"]);
    runCommand(helper, [
      "--db",
      destination,
      "--source",
      incoming,
      "--init-issuer",
      bootstrap.issuer,
      "--init-subject",
      bootstrap.subject,
      ...(sourceUser ? ["--source-user", sourceUser] : []),
    ]);
  }
  await writeComposeEnv(config, envFile, stateDir);
  await writeOwner(stateDir, {
    slot,
    project: projectFor(slot),
    appUrl: config.identity.APP_PUBLIC_URL,
    casdoorUrl: config.identity.CASDOOR_PUBLIC_URL,
    ports: portsFor(config),
    ownerSubject: config.ownerSubject ?? null,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  });
  console.log(
    `Dev setup ready: ${config.identity.APP_PUBLIC_URL} (Casdoor: ${config.identity.CASDOOR_PUBLIC_URL})`,
  );
  console.log(`Start with: ${composeCommandFor(slot)}`);
}

export async function run(values, positionals) {
  validateSetup(values, positionals);
  const { slot, stateDir, envFile, source, slotOptions } = await resolveSetupScope(values);
  await withLock(stateDir, async () => {
    const hostname = values.tailnet
      ? nodeHostname(JSON.parse(runCommand("tailscale", ["status", "--json"], { capture: true })))
      : undefined;
    const config = await loadConfig(stateDir, true, source, hostname, slotOptions);
    if (source && (await exists(resolve(stateDir, "data", databaseName)))) {
      throw new Error(
        "Dev data already exists. Use refresh-db --user USER_ID --source-user SOURCE_ID --from to replace only the selected financial scope.",
      );
    }
    if (values["source-user"] && (await exists(resolve(stateDir, "data", databaseName))))
      throw new Error(
        "Dev data already exists. Select a user through refresh-db instead of setup.",
      );
    if (source) {
      config.source = source;
      await saveConfig(stateDir, config);
    }
    await setupFlow(config, values["source-user"], { stateDir, envFile, slot });
  });
}

export async function main(args) {
  process.umask(0o077);
  const { values, positionals } = parseSetupArgs(args);
  if (values.help) {
    console.log(
      "Usage: scripts/dev setup [--tailnet] [--from migrated-app.db] [--source-user SOURCE_ID] [--slot NAME] [--app-port N] [--casdoor-port N] [--backend-port N]",
    );
    return;
  }
  await run(values, positionals);
}

runIfCli(import.meta.url, process.argv, main);
