import { resolve } from "node:path";
import { composeEnvironment, projectFor, sanitizeSlot, stateDirFor } from "../config.mjs";
import { root, run } from "./shell.mjs";

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

export function compose(config, args) {
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
