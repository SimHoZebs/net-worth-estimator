import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { databaseName, snapshotFile, validateSnapshot } from "../database.mjs";
import { compose } from "./compose.mjs";
import { run } from "./shell.mjs";
import { snapshot } from "./snapshot.mjs";

export async function refreshData({ config, stateDir, slot, source, sourceUser, user, publishing }) {
  if (!user || !/^users\/[0-9a-f]{64}$/.test(user))
    throw new Error(
      "refreshData requires --user users/<64hex> for an existing user.",
    );
  const incoming = await snapshot(
    {
      ...config,
      source:
        source ??
        (publishing ? { file: resolve(stateDir, "data", databaseName) } : config.source),
    },
    stateDir,
  );
  validateSnapshot(incoming);
  const destination = resolve(stateDir, "data", databaseName);
  const backupDir = resolve(stateDir, "backups");
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  // Build before service interruption. This also proves the helper contract
  // matches the application's current schema and store API.
  const helper = resolve(stateDir, "refreshmodel");
  run("go", ["-C", "backend", "build", "-o", helper, "./cmd/refreshmodel"]);
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
      "--source-user",
      sourceUser,
      "--user",
      user,
      // Guest publication carries only public financial data: no receipts,
      // sync credentials or mappings, and no private defaults. The destination
      // must already exist as an ordinary user row (see setupdb --issuer/--subject).
      ...(publishing ? ["--financial-only"] : []),
    ]);
  } finally {
    compose(config, ["start", "--wait", "backend"]);
  }
  console.log(
    publishing
      ? "Guest scope published in the application database. Other users and all identity state remain unchanged."
      : "Selected dev user refreshed. Other users and all identity state remain unchanged.",
  );
  console.log(
    `The prior application database is in ${slot ? `tmp/dev-${slot}` : "tmp/dev"}/backups/.`,
  );
}
