import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { databaseName, snapshotFile, validateSnapshot } from "../database.mjs";
import { compose } from "./compose.mjs";
import { run } from "./shell.mjs";
import { snapshot } from "./snapshot.mjs";

export async function refreshData({ config, stateDir, slot, source, sourcePlan, plan, publishing }) {
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
      sourcePlan,
      ...(publishing ? ["--sample"] : ["--plan", plan]),
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
