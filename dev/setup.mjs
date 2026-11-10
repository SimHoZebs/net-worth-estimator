import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
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
  if (positionals.length > 0) throw new Error("Unexpected dev arguments. Use ./dev/main.mjs --help.");
  const slot = slotFromOptions(values);
  if (values.bulk !== undefined || values.clear !== undefined)
    throw new Error("--bulk and --clear apply only to seed.");
  if (values.pack !== undefined) throw new Error("--pack applies only to demo.");
  if (values.user)
    throw new Error(
      "--user applies only to refresh-db; setup binds a user to its verified dev identity",
    );
  if (
    (values["app-port"] !== undefined ||
      values["auth-port"] !== undefined ||
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
    authPort: values["auth-port"],
    backendPort: values["backend-port"],
  };
  const wantsExplicitPorts =
    explicitPorts.appPort !== undefined ||
    explicitPorts.authPort !== undefined ||
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
    let authPort = parsePort(explicitPorts.authPort, "--auth-port");
    let backendPort = parsePort(explicitPorts.backendPort, "--backend-port");
    const missing =
      (appPort === undefined ? 1 : 0) +
      (authPort === undefined ? 1 : 0) +
      (backendPort === undefined ? 1 : 0);
    if (missing > 0) {
      const free = await pickFreePorts(missing, [...used]);
      let cursor = 0;
      if (appPort === undefined) appPort = free[cursor++];
      if (authPort === undefined) authPort = free[cursor++];
      if (backendPort === undefined) backendPort = free[cursor++];
    }
    if (appPort === authPort) throw new Error("App and auth slot ports must differ");
    slotOptions = { slot, appPort, authPort, backendPort };
    // Clone the canonical database when the slot has no explicit source.
    if (!source) {
      const canonicalDb = resolve(canonicalStateDir, "data", databaseName);
      if (await exists(canonicalDb)) source = { file: canonicalDb };
    }
  } else if (wantsExplicitPorts) {
    slotOptions = {
      slot,
      appPort: explicitPorts.appPort === undefined ? undefined : Number(explicitPorts.appPort),
      authPort: explicitPorts.authPort === undefined ? undefined : Number(explicitPorts.authPort),
      backendPort:
        explicitPorts.backendPort === undefined ? undefined : Number(explicitPorts.backendPort),
    };
  }
  return { slot, stateDir, envFile, source, slotOptions };
}

export async function setupFlow(config, sourceUser, { stateDir, envFile, slot }) {
  if (originProfile(config.identity.APP_PUBLIC_URL, config.identity.AUTH_PUBLIC_URL)) {
    checkServe(
      config,
      JSON.parse(runCommand("tailscale", ["status", "--json"], { capture: true })),
      JSON.parse(runCommand("tailscale", ["serve", "status", "--json"], { capture: true })),
    );
  }
  const identityDir = resolve(stateDir, "auth");
  await mkdir(identityDir, { recursive: true, mode: 0o700 });
  await mkdir(resolve(stateDir, "data"), { recursive: true, mode: 0o700 });
  const destination = resolve(stateDir, "data", databaseName);
  const fresh = !(await exists(destination));
  if (!fresh) validateSnapshot(destination);
  const authDatabase = resolve(identityDir, "identity.db");
  const bootstrapPath = `${authDatabase}.bootstrap.json`;
  const bootstrapExists = await exists(bootstrapPath);
  const policyDatabase = resolve(stateDir, "data", "authorization.db");
  const policyExists = await exists(policyDatabase);
  if (!policyExists && (!fresh || bootstrapExists)) {
    throw new Error(
      "Dev authorization database is missing. Restore its backup or perform an explicit policy import. Setup will not recreate grants for an existing identity.",
    );
  }
  if (!bootstrapExists) {
    runCommand("bun", ["run", "auth/better-auth/test-support.ts"], {
      env: {
        ...process.env,
        ...config.identity,
        AUTH_DATABASE: authDatabase,
      },
    });
  }
  const bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8"));
  if (
    bootstrap.issuer !== config.identity.AUTH_PUBLIC_URL ||
    bootstrap.client_id !== config.identity.AUTH_CLIENT_ID ||
    bootstrap.username !== config.identity.TEST_AUTH_USER_NAME
  ) {
    throw new Error("Dev identity metadata does not match its saved configuration");
  }
  if (!bootstrap.guest_subject || typeof bootstrap.guest_subject !== "string") {
    throw new Error("Dev identity metadata requires a provisioned guest subject.");
  }
  if (config.guestSubject === null) {
    config.guestSubject = bootstrap.guest_subject;
    await saveConfig(stateDir, config);
  }
  if (!config.guestSubject || config.guestSubject === bootstrap.subject)
    throw new Error(
      `Set a verified provisioned guestSubject distinct from the bootstrap user in ${slot ? `tmp/dev-${slot}` : "tmp/dev"}/config.json. Anonymous traffic resolves to it.`,
    );
  if (!policyExists) {
    runCommand("go", [
      "-C",
      "backend",
      "run",
      "./cmd/authzctl",
      "--setup",
      "--db",
      policyDatabase,
      "--issuer",
      bootstrap.issuer,
      "--guest",
      bootstrap.guest_subject,
    ]);
  }
  if (fresh) {
    const incoming = await snapshot(config, stateDir);
    validateSnapshot(incoming);
    const helper = resolve(stateDir, "refreshmodel");
    runCommand("go", ["-C", "backend", "build", "-o", helper, "./cmd/refreshmodel"]);
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
    // Provision the guest destination row after owner initialization. The
    // guest must already exist in Better Auth after explicit provisioning;
    // setupdb only records the ordinary user row and its blank document.
    // Anonymous traffic resolves to bootstrap.guest_subject; publish-sample
    // copies reviewed content into that existing row with --financial-only.
    const setupHelper = resolve(stateDir, "setupdb");
    runCommand("go", ["-C", "backend", "build", "-o", setupHelper, "./cmd/setupdb"]);
    runCommand(setupHelper, [
      "--db",
      destination,
      "--issuer",
      bootstrap.issuer,
      "--subject",
      bootstrap.guest_subject,
    ]);
  }
  await writeComposeEnv(config, envFile, stateDir);
  await writeOwner(stateDir, {
    slot,
    project: projectFor(slot),
    appUrl: config.identity.APP_PUBLIC_URL,
    authUrl: config.identity.AUTH_PUBLIC_URL,
    ports: portsFor(config),
    guestSubject: config.guestSubject ?? null,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  });
  console.log(
    `Dev setup ready: ${config.identity.APP_PUBLIC_URL} (Auth: ${config.identity.AUTH_PUBLIC_URL})`,
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
      "Usage: ./dev/main.mjs setup [--tailnet] [--from migrated-app.db] [--source-user SOURCE_ID] [--slot NAME] [--app-port N] [--auth-port N] [--backend-port N]",
    );
    return;
  }
  await run(values, positionals);
}

runIfCli(import.meta.url, process.argv, main);
