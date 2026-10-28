import { randomUUID } from "node:crypto";
import { chmod, mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { snapshotFile } from "../database.mjs";
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
    const running = run("docker", ["inspect", "-f", "{{.State.Running}}", container], {
      capture: true,
    }).trim();
    if (running !== "false")
      throw new Error(`Stop ${container} first so the database file copies cleanly.`);
    const info = JSON.parse(run("docker", ["inspect", container], { capture: true }))[0];
    const startedAt = info.State?.StartedAt;
    const entry = info.Config.Env.find((item) => item.startsWith("NET_WORTH_ESTIMATOR_DB="));
    const source = entry?.slice(entry.indexOf("=") + 1) || "/data/net-worth-estimator.db";
    // Plain file copy out of the stopped container, then a validated
    // backup into the snapshot directory.
    const staging = resolve(directory, `copy-${Date.now()}-${randomUUID()}.db`);
    try {
      run("docker", ["cp", `${container}:${source}`, staging]);
      await chmod(staging, 0o600);
      try {
        run("docker", ["cp", `${container}:${source}-wal`, `${staging}-wal`]);
        await chmod(`${staging}-wal`, 0o600);
      } catch {
        // No WAL companion: a clean shutdown already checkpointed it.
      }
      // The container must have stayed stopped through both copies.
      const after = run("docker", ["inspect", "-f", "{{.State.Running}} {{.State.StartedAt}}", container], {
        capture: true,
      }).trim();
      if (after !== `false ${startedAt}`)
        throw new Error(
          `${container} changed during the copy. Leave it stopped and retry the command.`,
        );
      await snapshotFile(staging, destination);
    } finally {
      await unlink(staging).catch(() => {});
      await unlink(`${staging}-wal`).catch(() => {});
    }
  }
  return destination;
}
