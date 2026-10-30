import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  composeEnvironment,
  envFileFor,
  loadConfig,
  newConfig,
  originProfile,
  projectFor,
  sanitizeSlot,
  stateDirFor,
} from "./config.mjs";
import { composeArgs, composeCommandFor } from "./lib/compose.mjs";
import { pickFreePorts } from "./lib/slots.mjs";
import { validateSetup } from "./setup.mjs";
import { validateStatus } from "./ps-all.mjs";

test("slots stay on lowercase names with isolated projects, state, and env files", () => {
  assert.equal(sanitizeSlot(undefined), "");
  assert.equal(sanitizeSlot(""), "");
  assert.equal(sanitizeSlot("shots"), "shots");
  assert.throws(() => sanitizeSlot("Has-Caps"), /Slot names/);
  assert.throws(() => sanitizeSlot("../escape"), /Slot names/);
  assert.equal(projectFor(""), "waypoint-dev");
  assert.equal(projectFor("shots"), "waypoint-dev-shots");
  assert.equal(stateDirFor("/repo", ""), resolve("/repo", "tmp/dev"));
  assert.equal(stateDirFor("/repo", "shots"), resolve("/repo", "tmp/dev-shots"));
  assert.equal(envFileFor("/repo", ""), resolve("/repo", ".env.dev"));
  assert.equal(envFileFor("/repo", "shots"), resolve("/repo", ".env.dev.shots"));
  assert.equal(
    composeCommandFor("shots"),
    "docker compose --env-file .env.dev.shots -f docker-compose.dev.yml -p waypoint-dev-shots up -d --build --wait",
  );
  assert.ok(composeCommandFor("").includes("--env-file .env.dev "));
});

test("slot configs use free loopback ports and refuse tailnet", () => {
  const config = newConfig(undefined, undefined, {
    slot: "shots",
    appPort: 5180,
    casdoorPort: 8100,
    backendPort: 8888,
  });
  assert.equal(config.slot, "shots");
  assert.equal(config.identity.APP_PUBLIC_URL, "http://localhost:5180");
  assert.equal(config.identity.CASDOOR_PUBLIC_URL, "http://localhost:8100");
  assert.deepEqual(config.ports, { app: 5180, casdoor: 8100, backend: 8888 });
  assert.equal(originProfile(config.identity.APP_PUBLIC_URL, config.identity.CASDOOR_PUBLIC_URL), null);
  assert.throws(
    () => newConfig(undefined, "test-node.example.ts.net", { slot: "shots" }),
    /canonical stack/,
  );
  assert.throws(() => newConfig(undefined, undefined, { slot: "bad name" }), /Slot names/);
  assert.throws(
    () => newConfig(undefined, undefined, { slot: "x", appPort: 8100, casdoorPort: 8100 }),
    /differ/,
  );
});

test("slot compose args isolate the project without touching the canonical default", () => {
  const canonical = composeArgs(["up"]);
  assert.ok(canonical.includes("waypoint-dev"));
  const slot = composeArgs(["up"], "shots");
  assert.ok(slot.includes("waypoint-dev-shots"));
  assert.equal(slot.at(-1), "up");
});

test("ps-all and slot options validate before any service operation", () => {
  assert.doesNotThrow(() => validateStatus({}, []));
  assert.throws(() => validateStatus({ slot: "shots" }, []), /bare/);
  assert.doesNotThrow(() =>
    validateSetup({ slot: "shots", "source-user": "users/owner" }, []),
  );
  assert.throws(() => validateSetup({ slot: "Bad Name" }, []), /Slot names/);
});

test("slot state rejects another slot name and fixed-port changes", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "waypoint-dev-slot-"));
  try {
    await loadConfig(dir, true, undefined, undefined, {
      slot: "shots",
      appPort: 5181,
      casdoorPort: 8101,
      backendPort: 8889,
    });
    await assert.rejects(() => loadConfig(dir, false, undefined, undefined, { slot: "other" }), /another slot/);
    await assert.rejects(
      () => loadConfig(dir, false, undefined, undefined, { slot: "shots", appPort: 9999 }),
      /fixed at creation/,
    );
    const same = await loadConfig(dir, false, undefined, undefined, { slot: "shots", appPort: 5181 });
    assert.equal(same.slot, "shots");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("free port picker returns distinct loopback ports", async () => {
  const ports = await pickFreePorts(3, [5178, 8000, 8788]);
  assert.equal(ports.length, 3);
  assert.equal(new Set(ports).size, 3);
  for (const port of ports) {
    assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
    assert.ok(![5178, 8000, 8788].includes(port));
  }
});

test("slot compose file isolates project, ports, and state", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "waypoint-dev-slot-compose-"));
  const path = resolve(dir, ".env.dev.shots");
  const config = newConfig(undefined, undefined, {
    slot: "shots",
    appPort: 5182,
    casdoorPort: 8102,
    backendPort: 8890,
  });
  const { writeComposeEnv } = await import("./config.mjs");
  const stateDir = resolve(dir, "tmp/dev-shots");
  await writeComposeEnv(config, path, stateDir);
  const contents = await readFile(path, "utf8");
  assert.ok(contents.includes("DEV_PROJECT='waypoint-dev-shots'"));
  assert.ok(contents.includes("DEV_FRONTEND_PORT='5182'"));
  assert.ok(contents.includes(`DEV_SLOT_STATE_DIR='${stateDir}'`));
  const args = ["compose", "--env-file", path, "-f", resolve("docker-compose.dev.yml"), "config"];
  const result = spawnSync("docker", [...args, "--format", "json"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  assert.equal(result.status, 0, result.stderr);
  const model = JSON.parse(result.stdout);
  assert.equal(model.name, "waypoint-dev-shots");
  assert.equal(model.services.frontend.ports[0].published, "5182");
  assert.equal(model.services.casdoor.ports[0].published, "8102");
  assert.equal(model.services.backend.ports[0].published, "8890");
  assert.ok(model.services.backend.volumes[0].source.startsWith(stateDir));
});
