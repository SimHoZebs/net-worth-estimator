import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { newConfig } from "./config.mjs";
import { setupFlow } from "./setup.mjs";

test("fresh setup provisions policies but existing identity never repairs lost revoked policies", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "waypoint-dev-policy-"));
  const source = resolve(directory, "source.db");
  const stateDir = resolve(directory, "slot");
  const scope = { stateDir, envFile: resolve(directory, ".env.dev.policy"), slot: "policy" };
  const runGo = (args) => {
    const result = spawnSync("go", ["-C", "backend", "run", ...args], {
      encoding: "utf8",
      env: { ...process.env, CGO_ENABLED: "0" },
    });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    const issuer = "https://source.test";
    runGo(["./cmd/setupdb", "--db", source, "--issuer", issuer, "--subject", "owner"]);
    const config = newConfig({ file: source }, undefined, {
      slot: "policy",
      appPort: 19781,
      authPort: 19782,
      backendPort: 19783,
    });
    const sourceUser = "user:" + createHash("sha256").update(`${issuer}\0owner`).digest("hex");
    await setupFlow(config, sourceUser, scope);
    const identityPath = resolve(stateDir, "auth", "identity.db");
    const bootstrap = JSON.parse(await readFile(`${identityPath}.bootstrap.json`, "utf8"));
    const policyPath = resolve(stateDir, "data", "authorization.db");
    const appPath = resolve(stateDir, "data", "net-worth-estimator.db");
    runGo([
      "./cmd/authzctl",
      "--db",
      policyPath,
      "--issuer",
      bootstrap.issuer,
      "--guest",
      bootstrap.guest_subject,
      "--subject",
      bootstrap.subject,
      "--role",
      "none",
    ]);
    const policies = new DatabaseSync(policyPath, { readOnly: true });
    assert.ok(policies.prepare("SELECT actor FROM authorization_subjects WHERE role='none'").get());
    policies.close();
    const identityBefore = await readFile(identityPath),
      appBefore = await readFile(appPath);
    await unlink(policyPath);
    await assert.rejects(
      () => setupFlow(config, sourceUser, scope),
      /authorization database is missing/,
    );
    await assert.rejects(() => readFile(policyPath), { code: "ENOENT" });
    assert.deepEqual(await readFile(identityPath), identityBefore);
    assert.deepEqual(await readFile(appPath), appBefore);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
