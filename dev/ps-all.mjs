import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { projectFor } from "./config.mjs";
import { devOptions } from "./lib/args.mjs";
import { composeCommandFor } from "./lib/compose.mjs";
import { runIfCli } from "./lib/entry.mjs";
import { exists, root } from "./lib/shell.mjs";
import { readOwner } from "./lib/slots.mjs";

export function parseStatusArgs(args) {
  return parseArgs({ args, allowPositionals: true, options: devOptions });
}

export function validateStatus(values, positionals = []) {
  if (positionals.length > 0) throw new Error("Unexpected dev arguments. Use scripts/dev --help.");
  if (values.slot || values.from || values.plan || values["source-plan"]) {
    throw new Error("ps-all takes no scope options. Run it bare to list every dev stack.");
  }
}

export async function run(values, positionals) {
  validateStatus(values, positionals);
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
    let isDir = false;
    try {
      isDir = (await stat(dir)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const owner = await readOwner(dir);
    const hasConfig = await exists(resolve(dir, "config.json"));
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

export async function main(args) {
  process.umask(0o077);
  const { values, positionals } = parseStatusArgs(args);
  if (values.help) {
    console.log("Usage: scripts/dev ps-all");
    return;
  }
  await run(values, positionals);
}

runIfCli(import.meta.url, process.argv, main);
