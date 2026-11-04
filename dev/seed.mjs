import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  loadConfig,
  slotFromOptions,
  stateDirFor,
  withLock,
} from "./config.mjs";
import { databaseName, snapshotFile, validateSnapshot } from "./database.mjs";
import { devOptions } from "./lib/args.mjs";
import { compose } from "./lib/compose.mjs";
import { runIfCli } from "./lib/entry.mjs";
import { exists, root, run as runCommand } from "./lib/shell.mjs";

export function parseSeedArgs(args) {
  return parseArgs({ args, allowPositionals: true, options: devOptions });
}

export function validateSeed(values, positionals = []) {
  if (positionals.length > 0) throw new Error("Unexpected dev arguments. Use scripts/dev --help.");
  slotFromOptions(values);
  if (values.tailnet) throw new Error("--tailnet applies only to setup");
  if (values.pack !== undefined)
    throw new Error("--pack applies only to demo.");
  if (
    values["app-port"] !== undefined ||
    values["casdoor-port"] !== undefined ||
    values["backend-port"] !== undefined
  ) {
    throw new Error("Ports are fixed at slot creation. Pick a new --slot name for new ports.");
  }
  if (values.from !== undefined || values["source-user"] !== undefined)
    throw new Error("Seed adds tagged rows to the existing dev user. Use refresh-db to replace from a snapshot.");
  const wantsBulk = values.bulk !== undefined && values.bulk !== "";
  const wantsClear = values.clear === true;
  if (wantsBulk === wantsClear)
    throw new Error("Seed needs exactly one of --bulk NxM[:seed] or --clear.");
  // Loose syntax check fails typos before the backup and backend restart.
  // Range enforcement stays owned by the helper parser.
  if (wantsBulk && !/^\d+\s*x\s*\d+\s*(?::\s*-?\d+\s*)?$/.test(values.bulk))
    throw new Error("Seed --bulk wants NxM[:seed] like 20x200:7.");
  if (values.user !== undefined && !/^users\/[0-9a-f]{64}$/.test(values.user))
    throw new Error("Seed --user names an existing user like users/<64hex>.");
}

export function actorResource(issuer, subject) {
  return `users/${createHash("sha256").update(`${issuer}\x00${subject}`, "utf8").digest("hex")}`;
}

export async function run(values, positionals) {
  validateSeed(values, positionals);
  const slot = slotFromOptions(values);
  const stateDir = stateDirFor(root, slot);
  await withLock(stateDir, async () => {
    const config = await loadConfig(stateDir, false, undefined, undefined, { slot });
    const bootstrap = JSON.parse(
      await readFile(resolve(stateDir, "casdoor", "bootstrap.json"), "utf8"),
    );
    if (!bootstrap.issuer || typeof bootstrap.issuer !== "string")
      throw new Error("Dev identity bootstrap is missing its issuer.");
    let target = values.user;
    if (!target) {
      if (!config.ownerSubject)
        throw new Error("Dev state has no verified owner. Run setup first or pass --user.");
      target = actorResource(bootstrap.issuer, config.ownerSubject);
    }
    const destination = resolve(stateDir, "data", databaseName);
    if (!(await exists(destination))) throw new Error("Dev data is missing. Run setup first.");
    validateSnapshot(destination);
    const backupDir = resolve(stateDir, "backups");
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const helper = resolve(stateDir, "seedtest");
    runCommand("go", ["-C", "backend", "build", "-o", helper, "./cmd/seedtest"]);
    await snapshotFile(
      destination,
      resolve(backupDir, `application-${Date.now()}-${randomUUID()}.db`),
    );
    compose(config, ["stop", "backend"]);
    try {
      runCommand(helper, [
        "--db",
        destination,
        "--user",
        target,
        ...(values.clear ? ["--clear"] : ["--bulk", values.bulk]),
      ]);
    } finally {
      compose(config, ["start", "--wait", "backend"]);
    }
    console.log(
      values.clear
        ? "Tagged bulk rows cleared. Other users and all identity state remain unchanged."
        : "Tagged bulk rows injected beside the existing dev data. Clear them later with seed --clear.",
    );
    console.log(
      `The prior application database is in ${slot ? `tmp/dev-${slot}` : "tmp/dev"}/backups/.`,
    );
  });
}

export async function main(args) {
  process.umask(0o077);
  const { values, positionals } = parseSeedArgs(args);
  if (values.help) {
    console.log(
      "Usage: scripts/dev seed (--bulk NxM[:seed] | --clear) [--user users/<64hex>] [--slot NAME]",
    );
    return;
  }
  await run(values, positionals);
}

runIfCli(import.meta.url, process.argv, main);
