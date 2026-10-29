import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, slotFromOptions, stateDirFor, withLock } from "./config.mjs";
import { devOptions } from "./lib/args.mjs";
import { runIfCli } from "./lib/entry.mjs";
import { refreshData } from "./lib/refresh.mjs";
import { root } from "./lib/shell.mjs";

export function parseRefreshArgs(args) {
  return parseArgs({ args, allowPositionals: true, options: devOptions });
}

export function validateRefresh(values, positionals = []) {
  if (positionals.length > 0) throw new Error("Unexpected dev arguments. Use scripts/dev --help.");
  slotFromOptions(values);
  if (values.tailnet) throw new Error("--tailnet applies only to setup");
  if (
    values["app-port"] !== undefined ||
    values["casdoor-port"] !== undefined ||
    values["backend-port"] !== undefined
  ) {
    throw new Error("Ports are fixed at slot creation. Pick a new --slot name for new ports.");
  }
  if (values["source-account"] && values["source-plan"])
    throw new Error("--source-plan and --source-account conflict; use --source-account");
  if (values.account && values.plan)
    throw new Error("--plan and --account conflict; use --account");
  const source = values["source-account"] ?? values["source-plan"];
  const target = values.account ?? values.plan;
  if (!source)
    throw new Error("--source-account is required. Select the reviewed financial scope explicitly.");
  if (!target || target === "plans/sample" || target === "sample")
    throw new Error("refresh-db requires --account for an existing private account scope");
}

export async function run(values, positionals) {
  validateRefresh(values, positionals);
  const slot = slotFromOptions(values);
  const stateDir = stateDirFor(root, slot);
  const source = values.from ? { file: resolve(values.from) } : undefined;
  await withLock(stateDir, async () => {
    const config = await loadConfig(stateDir, false, source, undefined, { slot });
    await refreshData({
      config,
      stateDir,
      slot,
      source,
      sourcePlan: values["source-account"] ?? values["source-plan"],
      plan: values.account ?? values.plan,
      publishing: false,
    });
  });
}

export async function main(args) {
  process.umask(0o077);
  const { values, positionals } = parseRefreshArgs(args);
  if (values.help) {
    console.log(
      "Usage: scripts/dev refresh-db --account ACCOUNT_ID --source-account SOURCE_ID [--from migrated-app.db] [--slot NAME]",
    );
    return;
  }
  await run(values, positionals);
}

runIfCli(import.meta.url, process.argv, main);
