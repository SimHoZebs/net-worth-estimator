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

export function parsePublishArgs(args) {
  return parseArgs({ args, allowPositionals: true, options: devOptions });
}

export function validatePublish(values, positionals = []) {
  rejectPositionals(positionals);
  checkSlot(values);
  rejectBulkClearExceptSeed(values);
  rejectPackExceptDemo(values);
  rejectTailnet(values);
  rejectPortsAfterCreation(values);
  if (!values["source-user"])
    throw new Error("--source-user is required. Select the reviewed financial scope explicitly.");
  // Publication targets the provisioned guest's user resource.
  if (!values.user || !/^users\/[0-9a-f]{64}$/.test(values.user))
    throw new Error(
      "publish-sample requires --user users/<guest-hash> for the provisioned guest scope.",
    );
}

export async function run(values, positionals) {
  await runRefreshCommand(values, positionals, validatePublish, true);
}

export async function main(args) {
  process.umask(0o077);
  const { values, positionals } = parsePublishArgs(args);
  if (values.help) {
    console.log(
      "Usage: ./dev/main.mjs publish-sample --user users/<guest-hash> --source-user SOURCE_ID [--from approved-app.db] [--slot NAME]",
    );
    return;
  }
  await run(values, positionals);
}

runIfCli(import.meta.url, process.argv, main);
