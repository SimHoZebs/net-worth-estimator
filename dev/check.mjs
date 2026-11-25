import { parseArgs } from "node:util";
import { parseLoopbackPort } from "./config.mjs";
import { devOptions } from "./lib/args.mjs";
import { runIfCli } from "./lib/entry.mjs";
import { portIsAvailable, usedSlotPorts } from "./lib/slots.mjs";

export function validateCheck(values, positionals = []) {
  if (positionals.length > 0)
    throw new Error("Unexpected check arguments. Use scripts/dev check --port N.");
  for (const key of Object.keys(devOptions)) {
    if (key !== "port" && key !== "help" && values[key] !== undefined)
      throw new Error(`--${key} does not apply to check.`);
  }
  if (values.port === undefined) throw new Error("--port N is required.");
  return { port: parseLoopbackPort(values.port, "--port") };
}

export async function run(values, positionals) {
  const { port } = validateCheck(values, positionals);
  const [available, reserved] = await Promise.all([portIsAvailable(port), usedSlotPorts()]);
  if (reserved.has(port))
    throw new Error(
      `Port ${port} is reserved by a dev stack. Run scripts/dev ps-all and choose another port.`,
    );
  if (!available)
    throw new Error(
      `Port ${port} is already in use on a loopback address. Inspect the listener or choose another port.`,
    );
  console.log(`Port ${port} is available.`);
}

export async function main(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: devOptions,
  });
  if (values.help) {
    console.log("Usage: scripts/dev check --port N");
    return;
  }
  await run(values, positionals);
}

runIfCli(import.meta.url, process.argv, main);
