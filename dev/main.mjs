import { parseArgs } from "node:util";
import { run as runSetup } from "./setup.mjs";
import { run as runRefresh } from "./refresh-db.mjs";
import { run as runPublish } from "./publish-sample.mjs";
import { run as runStatus } from "./ps-all.mjs";
import { devOptions } from "./lib/args.mjs";
import { runIfCli } from "./lib/entry.mjs";

const commands = {
  setup: runSetup,
  "refresh-db": runRefresh,
  "publish-sample": runPublish,
  "ps-all": runStatus,
};

export function parseMainArgs(args) {
  return parseArgs({ args, allowPositionals: true, options: devOptions });
}

export async function main(args) {
  process.umask(0o077);
  const { values, positionals } = parseMainArgs(args);
  if (values.help) {
    console.log(
      "Usage: scripts/dev setup [--tailnet] [--from migrated-app.db] [--source-account SOURCE_ID] [--slot NAME] [--app-port N] [--casdoor-port N] [--backend-port N] | refresh-db --account ACCOUNT_ID --source-account SOURCE_ID [--from migrated-app.db] [--slot NAME] | publish-sample --source-account SOURCE_ID [--from approved-app.db] [--slot NAME] | ps-all",
    );
    return;
  }
  const [command, ...rest] = positionals;
  if (command === "grant")
    throw new Error(
      "Access is automatic for each account's own scope. Casdoor manages resource permissions; no global editor grant is needed.",
    );
  const run = commands[command];
  if (!run)
    throw new Error(
      "Use scripts/dev setup once. Use docker compose --env-file .env.dev -f docker-compose.dev.yml for up, down, ps, and logs.",
    );
  await run(values, rest);
}

runIfCli(import.meta.url, process.argv, main);
