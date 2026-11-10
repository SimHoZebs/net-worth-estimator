import { parseArgs } from "node:util";
import { devOptions } from "./lib/args.mjs";
import { runIfCli } from "./lib/entry.mjs";
import { runRefreshCommand } from "./lib/refresh.mjs";
import {
  checkSlot,
  rejectBulkClearExceptSeed,
  rejectPackExceptDemo,
  rejectPortsAfterCreation,
  rejectPositionals,
  rejectTailnet,
} from "./lib/validate.mjs";

export function parseRefreshArgs(args) {
  return parseArgs({ args, allowPositionals: true, options: devOptions });
}

export function validateRefresh(values, positionals = []) {
  rejectPositionals(positionals);
  checkSlot(values);
  rejectBulkClearExceptSeed(values);
  rejectPackExceptDemo(values);
  rejectTailnet(values);
  rejectPortsAfterCreation(values);
  if (!values["source-user"])
    throw new Error("--source-user is required. Select the reviewed financial scope explicitly.");
  if (!values.user)
    throw new Error("refresh-db requires --user for an existing user");
}

export async function run(values, positionals) {
  await runRefreshCommand(values, positionals, validateRefresh, false);
}

export async function main(args) {
  process.umask(0o077);
  const { values, positionals } = parseRefreshArgs(args);
  if (values.help) {
    console.log(
      "Usage: ./dev/main.mjs refresh-db --user USER_ID --source-user SOURCE_ID [--from migrated-app.db] [--slot NAME]",
    );
    return;
  }
  await run(values, positionals);
}

runIfCli(import.meta.url, process.argv, main);
