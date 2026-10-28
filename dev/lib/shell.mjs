import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));

export function run(command, args, { capture = false, env = process.env, output } = {}) {
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

export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
