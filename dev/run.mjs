import { spawnSync } from "node:child_process";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { generate } from "../auth/casdoor/generate.mjs";
import { writeBootstrap } from "../auth/casdoor/provision.mjs";
import { databaseName, snapshotFile, validateSnapshot } from "./database.mjs";
import {
  composeEnvironment,
  defaultPorts,
  envFileFor,
  loadConfig,
  originProfile,
  portsFor,
  projectFor,
  sanitizeSlot,
  saveConfig,
  settings,
  slotFromOptions,
  stateDirFor,
  withLock,
  writeComposeEnv,
} from "./config.mjs";
import { checkServe, nodeHostname } from "./tailnet.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const canonicalStateDir = resolve(root, "tmp/dev");
const canonicalEnvFile = resolve(root, ".env.dev");

function run(command, args, { capture = false, env = process.env, output } = {}) {
  const stdio =
    output === undefined
      ? capture
        ? ["ignore", "pipe", "pipe"]
        : "inherit"
      : ["ignore", output, "inherit"];
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", stdio });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} failed (${result.status}).${capture ? ` Check ${command} access and configuration.` : " See the command output above."}`,
    );
  return result.stdout;
}

export function composeArgs(args, slot = "") {
  return [
    "compose",
    "--project-directory",
    root,
    "-f",
    resolve(root, "docker-compose.dev.yml"),
    "-p",
    projectFor(slot),
    ...args,
  ];
}

function compose(config, args) {
  const slot = sanitizeSlot(config.slot ?? "");
  const stateDir = stateDirFor(root, slot);
  return run("docker", composeArgs(args, slot), {
    env: { ...process.env, ...composeEnvironment(config), DEV_SLOT_STATE_DIR: stateDir },
  });
}

export function composeCommandFor(slot) {
  const clean = sanitizeSlot(slot);
  const envFile = clean ? `.env.dev.${clean}` : ".env.dev";
  const project = projectFor(clean);
  return `docker compose --env-file ${envFile} -f docker-compose.dev.yml -p ${project} up -d --build --wait`;
}

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

export async function pickFreePorts(count, used = []) {
  const taken = new Set(used);
  const ports = [];
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const port = await freePort();
      if (port < 1024 || taken.has(port)) continue;
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

async function writeOwner(stateDir, owner) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFile(resolve(stateDir, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function snapshot(config, stateDir) {
  const directory = resolve(stateDir, "snapshots");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = resolve(directory, `${Date.now()}-${randomUUID()}.db`);
  if (config.source.file) {
    await snapshotFile(config.source.file, destination);
  } else {
    const container = config.source.container;
    if (!container || container.startsWith("-"))
      throw new Error("A production source container is required");
    const info = JSON.parse(run("docker", ["inspect", container], { capture: true }))[0];
    const entry = info.Config.Env.find((item) => item.startsWith("NET_WORTH_ESTIMATOR_DB="));
    const source = entry?.slice(entry.indexOf("=") + 1) || "/data/net-worth-estimator.db";
    if (
      !source.startsWith("/") ||
      resolve(source) !== source ||
      !info.Mounts.some((mount) => source.startsWith(`${mount.Destination}/`))
    ) {
      throw new Error("The production database must be an absolute path inside a mounted volume");
    }
    const owner = run("docker", ["exec", container, "stat", "-c", "%u:%g", source], {
      capture: true,
    }).trim();
    if (!/^[1-9]\d*:\d+$/.test(owner))
      throw new Error(
        "Automatic snapshots require a non-root database owner. Use --from with a SQLite backup instead.",
      );
    // The source volume is read-only. The helper has no network or capabilities.
    run("docker", [
      "build",
      "-q",
      "-f",
      "dev/snapshot.Dockerfile",
      "-t",
      "waypoint-dev-snapshot:local",
      ".",
    ]);
    const output = await open(destination, "wx", 0o600);
    try {
      run(
        "docker",
        [
          "run",
          "--rm",
          "--network",
          "none",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges:true",
          "--user",
          owner,
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=512m",
          "--volumes-from",
          `${container}:ro`,
          "waypoint-dev-snapshot:local",
          source,
          "--stdout",
        ],
        { output: output.fd },
      );
      validateSnapshot(destination);
    } catch (error) {
      await unlink(destination);
      throw error;
    } finally {
      await output.close();
    }
  }
  return destination;
}

async function setup(config, sourcePlan, ctx) {
  const { stateDir, envFile, slot } = ctx;
  if (originProfile(config.identity.APP_PUBLIC_URL, config.identity.CASDOOR_PUBLIC_URL)) {
    checkServe(
      config,
      JSON.parse(run("tailscale", ["status", "--json"], { capture: true })),
      JSON.parse(run("tailscale", ["serve", "status", "--json"], { capture: true })),
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
      `Set the verified Bridge ownerSubject in ${slot ? `tmp/dev-${slot}` : "tmp/dev"}/config.json. Plan ownership comes from the application database.`,
    );
  if (fresh) {
    const incoming = await snapshot(config, stateDir);
    if (validateSnapshot(incoming) !== "application")
      throw new Error(
        `Legacy snapshot saved at ${incoming} has no migration path. Use a current application database instead.`,
      );
    const helper = resolve(stateDir, "refreshplan");
    run("go", ["-C", "backend", "build", "-o", helper, "./cmd/refreshplan"]);
    run(helper, [
      "--db",
      destination,
      "--source",
      incoming,
      "--init-issuer",
      bootstrap.issuer,
      "--init-subject",
      bootstrap.subject,
      ...(sourcePlan ? ["--source-plan", sourcePlan] : []),
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

export async function main(args) {
  process.umask(0o077);
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      from: { type: "string" },
      plan: { type: "string" },
      "source-plan": { type: "string" },
      slot: { type: "string" },
      "app-port": { type: "string" },
      "casdoor-port": { type: "string" },
      "backend-port": { type: "string" },
      tailnet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command] = positionals;
  if (values.help) {
    console.log(
      "Usage: scripts/dev setup [--tailnet] [--from migrated-app.db] [--source-plan SOURCE_ID] [--slot NAME] [--app-port N] [--casdoor-port N] [--backend-port N] | refresh-db --plan PLAN_ID --source-plan SOURCE_ID [--from migrated-app.db] [--slot NAME] | publish-sample --source-plan SOURCE_ID [--from approved-app.db] [--slot NAME] | ps-all",
    );
    return;
  }
  if (command === "grant")
    throw new Error(
      "Access is automatic for each account's own plan. Casdoor manages resource permissions; no global editor grant is needed.",
    );
  if (command === "ps-all") {
    if (positionals.length > 1) throw new Error("Unexpected dev arguments. Use scripts/dev --help.");
    await psAll();
    return;
  }
  if (!["setup", "refresh-db", "publish-sample"].includes(command))
    throw new Error(
      "Use scripts/dev setup once. Use docker compose --env-file .env.dev -f docker-compose.dev.yml for up, down, ps, and logs.",
    );
  if (positionals.length > 1) throw new Error("Unexpected dev arguments. Use scripts/dev --help.");
  if (values.tailnet && command !== "setup") throw new Error("--tailnet applies only to setup");
  validateOperation(command, values);
  const slot = slotFromOptions(values);
  if (values.tailnet && slot !== "") throw new Error("--tailnet applies only to the canonical stack");
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
  if (slot === "" && wantsExplicitPorts) {
    throw new Error("Canonical ports are fixed at 5178/8000/8788. Use --slot for custom ports.");
  }
  if (command !== "setup" && wantsExplicitPorts) {
    throw new Error("Ports are fixed at slot creation. Pick a new --slot name for new ports.");
  }
  // Resolve ports before the lock so validation failures leave no empty state dir.
  let slotOptions = { slot };
  if (command === "setup" && slot !== "" && !(await exists(resolve(stateDir, "config.json")))) {
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
  await withLock(stateDir, async () => {
    const hostname = values.tailnet
      ? nodeHostname(JSON.parse(run("tailscale", ["status", "--json"], { capture: true })))
      : undefined;
    const config = await loadConfig(stateDir, command === "setup", source, hostname, slotOptions);
    if (command === "setup") {
      if (source && (await exists(resolve(stateDir, "data", databaseName)))) {
        throw new Error(
          "Dev data already exists. Use refresh-db --plan PLAN_ID --source-plan SOURCE_ID --from to replace only the selected financial scope.",
        );
      }
      if (values["source-plan"] && (await exists(resolve(stateDir, "data", databaseName))))
        throw new Error(
          "Dev data already exists. Select a plan through refresh-db instead of setup.",
        );
      if (source) {
        config.source = source;
        await saveConfig(stateDir, config);
      }
      await setup(config, values["source-plan"], { stateDir, envFile, slot });
    } else {
      const publishing = command === "publish-sample";
      const incoming = await snapshot(
        {
          ...config,
          source:
            source ??
            (publishing ? { file: resolve(stateDir, "data", databaseName) } : config.source),
        },
        stateDir,
      );
      if (validateSnapshot(incoming) !== "application")
        throw new Error(
          "Legacy source snapshots have no migration path. Refresh only imports current application databases.",
        );
      const destination = resolve(stateDir, "data", databaseName);
      const backupDir = resolve(stateDir, "backups");
      await mkdir(backupDir, { recursive: true, mode: 0o700 });
      // Build before service interruption. This also proves the helper contract
      // matches the application's current schema and store API.
      const helper = resolve(stateDir, "refreshplan");
      run("go", ["-C", "backend", "build", "-o", helper, "./cmd/refreshplan"]);
      compose(config, ["stop", "backend"]);
      try {
        await snapshotFile(
          destination,
          resolve(backupDir, `application-${Date.now()}-${randomUUID()}.db`),
        );
        run(helper, [
          "--db",
          destination,
          "--source",
          incoming,
          "--source-plan",
          values["source-plan"],
          ...(publishing ? ["--sample"] : ["--plan", values.plan]),
        ]);
      } finally {
        compose(config, ["start", "--wait", "backend"]);
      }
      console.log(
        publishing
          ? "Sample published in the application database. Private plans and all identity state remain unchanged."
          : "Selected dev plan refreshed. Other plans and all identity state remain unchanged.",
      );
      console.log(
        `The prior application database is in ${slot ? `tmp/dev-${slot}` : "tmp/dev"}/backups/.`,
      );
    }
  });
}

export async function usedSlotPorts(excludeSlot = "") {
  const used = new Set([defaultPorts.app, defaultPorts.casdoor, defaultPorts.backend]);
  const { readdir } = await import("node:fs/promises");
  let tmpEntries = [];
  try {
    tmpEntries = await readdir(resolve(root, "tmp"));
  } catch {
    return used;
  }
  // Scan tmp/dev* owner files for ports claimed by other stacks.
  for (const name of tmpEntries) {
    if (name !== "dev" && !name.startsWith("dev-")) continue;
    const slotName = name === "dev" ? "" : name.slice(4);
    if (slotName === sanitizeSlot(excludeSlot)) continue;
    const owner = await readOwner(resolve(root, `tmp/${name}`));
    if (!owner) continue;
    for (const url of [owner.appUrl, owner.casdoorUrl]) {
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
  return used;
}

export async function psAll() {
  const { readdir } = await import("node:fs/promises");
  let tmpEntries = [];
  try {
    tmpEntries = await readdir(resolve(root, "tmp"));
  } catch {
    console.log("No dev stacks found.");
    return;
  }
  const rows = [];
  for (const name of tmpEntries.sort()) {
    if (name !== "dev" && !name.startsWith("dev-")) continue;
    const dir = resolve(root, `tmp/${name}`);
    const owner = await readOwner(dir);
    const configPath = resolve(dir, "config.json");
    const hasConfig = await exists(configPath);
    const slot = name === "dev" ? "" : name.slice(4);
    rows.push({
      slot: slot || "(canonical)",
      project: projectFor(slot),
      app: owner?.appUrl ?? (hasConfig ? "configured" : "empty"),
      env: slot ? `.env.dev.${slot}` : ".env.dev",
      up: composeCommandFor(slot),
    });
  }
  if (rows.length === 0) {
    console.log("No dev stacks found.");
    return;
  }
  for (const row of rows) {
    console.log(`${row.slot} ${row.project} ${row.app}`);
    console.log(`  env: ${row.env}`);
    console.log(`  up: ${row.up}`);
  }
}

export function validateOperation(command, values) {
  if (command === "ps-all") {
    if (values.slot || values.from || values.plan || values["source-plan"]) {
      throw new Error("ps-all takes no scope options. Run it bare to list every dev stack.");
    }
    return;
  }
  if (values.slot !== undefined) sanitizeSlot(values.slot);
  if (command === "setup" && values.plan)
    throw new Error(
      "--plan applies only to refresh-db; setup binds a new plan to its verified dev identity",
    );
  if (command !== "setup" && !values["source-plan"])
    throw new Error("--source-plan is required. Select the reviewed financial scope explicitly.");
  if (command === "refresh-db" && (!values.plan || values.plan === "plans/sample"))
    throw new Error("refresh-db requires --plan for an existing private plan");
  if (command === "publish-sample" && values.plan)
    throw new Error("publish-sample always targets plans/sample; omit --plan");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
