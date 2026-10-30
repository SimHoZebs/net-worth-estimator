import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, slotFromOptions, stateDirFor, withLock } from "./config.mjs";
import { devOptions } from "./lib/args.mjs";
import { runIfCli } from "./lib/entry.mjs";
import { refreshData } from "./lib/refresh.mjs";
import { root } from "./lib/shell.mjs";

export function parsePublishArgs(args) {
  return parseArgs({ args, allowPositionals: true, options: devOptions });
}

export function validatePublish(values, positionals = []) {
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
  if (!values["source-user"])
    throw new Error("--source-user is required. Select the reviewed financial scope explicitly.");
  // The guest is a provisioned ordinary user, not a special sample row.
  // refreshmodel rejects legacy 'sample' destinations; pass the guest scope.
  if (!values.user || !/^users\/[0-9a-f]{64}$/.test(values.user))
    throw new Error(
      "publish-sample requires --user users/<guest-hash> for the provisioned guest scope. Legacy users/sample destinations are retired.",
    );
}

export async function run(values, positionals) {
  validatePublish(values, positionals);
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
      sourceUser: values["source-user"],
      user: values.user,
      publishing: true,
    });
  });
}

export async function main(args) {
  process.umask(0o077);
  const { values, positionals } = parsePublishArgs(args);
  if (values.help) {
    console.log(
      "Usage: scripts/dev publish-sample --user users/<guest-hash> --source-user SOURCE_ID [--from approved-app.db] [--slot NAME]",
    );
    return;
  }
  await run(values, positionals);
}

runIfCli(import.meta.url, process.argv, main);
