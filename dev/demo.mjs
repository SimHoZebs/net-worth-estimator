import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { devOptions } from "./lib/args.mjs";
import { runIfCli } from "./lib/entry.mjs";
import { root } from "./lib/shell.mjs";

const DEFAULT_PACK = "safe-spending";

export function parseDemoArgs(args) {
  return parseArgs({ args, allowPositionals: true, options: devOptions });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function anchorFor(packPath) {
  const pack = JSON.parse(readFileSync(packPath, "utf8"));
  const model = Array.isArray(pack.seeds)
    ? pack.seeds.find((seed) => seed.kind === "model")
    : undefined;
  return model?.anchorDate ?? todayIso();
}

export function validateDemo(values, positionals = []) {
  if (positionals.length > 0)
    throw new Error("Unexpected demo arguments. Use ./dev/main.mjs --help.");
  for (const key of [
    "bulk",
    "clear",
    "from",
    "source-user",
    "user",
    "slot",
    "tailnet",
    "app-port",
    "auth-port",
    "backend-port",
  ]) {
    if (values[key] !== undefined) throw new Error(`--${key} does not apply to demo.`);
  }
  const pack = values.pack ?? DEFAULT_PACK;
  if (!/^[a-z0-9-]+$/.test(pack))
    throw new Error("Demo --pack names a lowercase fixture pack like safe-spending.");
  const packPath = join(root, "backend/testdata/integration/v1", `${pack}.json`);
  if (!existsSync(packPath))
    throw new Error(`Demo pack ${pack} does not exist under backend/testdata/integration/v1.`);
  return { pack, anchor: anchorFor(packPath) };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

export async function run(values, positionals) {
  const { pack, anchor } = validateDemo(values, positionals);
  const [frontendPort, apiPort] = await Promise.all([freePort(), freePort()]);
  const env = {
    ...process.env,
    TEST_FRONTEND_PORT: String(frontendPort),
    TEST_API_PORT: String(apiPort),
    INTEGRATION_PACK: pack,
    DEMO_ANCHOR: anchor,
    DEMO_PACK: pack,
  };
  console.log(
    `demo: pack=${pack} anchor=${anchor} ui=http://127.0.0.1:${frontendPort}/#outlook/safe-spending-detail/cycle`,
  );
  const child = spawn(
    "bunx",
    [
      "--no-install",
      "playwright",
      "test",
      "--config",
      "playwright.demo.config.ts",
      ...(process.env.DEMO_HEADLESS === "1" ? [] : ["--headed"]),
    ],
    { cwd: join(root, "frontend"), env, stdio: "inherit" },
  );
  const stop = () => child.kill("SIGINT");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const code = await new Promise((resolve) => {
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  if (code !== 0) process.exitCode = code;
}

export async function main(args) {
  const { values, positionals } = parseDemoArgs(args);
  if (values.help) {
    console.log("Usage: ./dev/main.mjs demo [--pack NAME]");
    return;
  }
  await run(values, positionals);
}

runIfCli(import.meta.url, process.argv, main);
