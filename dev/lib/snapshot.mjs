import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { snapshotFile, validateSnapshot } from "../database.mjs";
import { run } from "./shell.mjs";

export async function snapshot(config, stateDir) {
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
