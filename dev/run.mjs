import { spawnSync } from "node:child_process";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { generate } from "../auth/casdoor/generate.mjs";
import { writeBootstrap } from "../auth/casdoor/provision.mjs";
import { databaseName, snapshotFile, validateSnapshot } from "./database.mjs";
import {
  composeEnvironment,
  loadConfig,
  originProfile,
  project,
  saveConfig,
  settings,
  withLock,
  writeComposeEnv,
} from "./config.mjs";
import { checkServe, nodeHostname } from "./tailnet.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const stateDir = resolve(root, "tmp/dev");

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

export function composeArgs(args) {
  return [
    "compose",
    "--project-directory",
    root,
    "-f",
    resolve(root, "docker-compose.dev.yml"),
    "-p",
    project,
    ...args,
  ];
}

function compose(config, args) {
  return run("docker", composeArgs(args), {
    env: { ...process.env, ...composeEnvironment(config) },
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

async function snapshot(config) {
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

async function setup(config, sourcePlan) {
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
      "Existing dev database requires offline migration. Preserve its identity and plan files, migrate with cmd/migratedb to a new path, then install the reviewed result explicitly.",
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
      "Set the verified Bridge ownerSubject in tmp/dev/config.json. Plan ownership comes from the application database and its migration manifest.",
    );
  if (fresh) {
    const incoming = await snapshot(config);
    if (validateSnapshot(incoming) !== "application")
      throw new Error(
        `Legacy snapshot saved at ${incoming}. Use setup --manifest with explicit source ownership to migrate it first.`,
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
  await writeComposeEnv(config, resolve(root, ".env.dev"));
  console.log(
    `Dev setup ready: ${config.identity.APP_PUBLIC_URL} (Casdoor: ${config.identity.CASDOOR_PUBLIC_URL})`,
  );
  console.log(
    "Start with: docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build --wait",
  );
}

export async function main(args) {
  process.umask(0o077);
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      from: { type: "string" },
      manifest: { type: "string" },
      plan: { type: "string" },
      "source-plan": { type: "string" },
      tailnet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command] = positionals;
  if (values.help) {
    console.log(
      "Usage: scripts/dev setup [--tailnet] [--from migrated-app.db | --manifest migration.json] [--source-plan SOURCE_ID] | refresh-db --plan PLAN_ID --source-plan SOURCE_ID [--from migrated-app.db] | publish-sample --source-plan SOURCE_ID [--from approved-app.db]",
    );
    return;
  }
  if (command === "grant")
    throw new Error(
      "Access is automatic for each account's own plan. Casdoor manages resource permissions; no global editor grant is needed.",
    );
  if (!["setup", "refresh-db", "publish-sample"].includes(command))
    throw new Error(
      "Use scripts/dev setup once. Use docker compose --env-file .env.dev -f docker-compose.dev.yml for up, down, ps, and logs.",
    );
  if (positionals.length > 1) throw new Error("Unexpected dev arguments. Use scripts/dev --help.");
  if (values.tailnet && command !== "setup") throw new Error("--tailnet applies only to setup");
  validateOperation(command, values);
  let source = values.from ? { file: resolve(values.from) } : undefined;
  await withLock(stateDir, async () => {
    const hostname = values.tailnet
      ? nodeHostname(JSON.parse(run("tailscale", ["status", "--json"], { capture: true })))
      : undefined;
    const config = await loadConfig(stateDir, command === "setup", source, hostname);
    if (command === "setup") {
      if ((source || values.manifest) && (await exists(resolve(stateDir, "data", databaseName)))) {
        throw new Error(
          "Dev data already exists. Use refresh-db --plan PLAN_ID --source-plan SOURCE_ID --from to replace only the selected financial scope.",
        );
      }
      if (values["source-plan"] && (await exists(resolve(stateDir, "data", databaseName))))
        throw new Error(
          "Dev data already exists. Select a plan through refresh-db instead of setup.",
        );
      if (values.manifest) {
        const directory = resolve(stateDir, "snapshots");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const migrated = resolve(directory, `migrated-${Date.now()}-${randomUUID()}.db`);
        run("go", [
          "-C",
          "backend",
          "run",
          "./cmd/migratedb",
          "--manifest",
          resolve(values.manifest),
          "--db",
          migrated,
        ]);
        source = { file: migrated };
      }
      if (source) {
        config.source = source;
        await saveConfig(stateDir, config);
      }
      await setup(config, values["source-plan"]);
    } else {
      const publishing = command === "publish-sample";
      const incoming = await snapshot({
        ...config,
        source:
          source ??
          (publishing ? { file: resolve(stateDir, "data", databaseName) } : config.source),
      });
      if (validateSnapshot(incoming) !== "application")
        throw new Error(
          "Migrate the source snapshot with cmd/migratedb first. Refresh never imports an unscoped legacy database.",
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
      console.log("The prior application database is in tmp/dev/backups/.");
    }
  });
}

export function validateOperation(command, values) {
  if (values.manifest && (command !== "setup" || values.from))
    throw new Error("--manifest applies only to setup and cannot combine with --from");
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
