import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { snapshotFile, validateSnapshot } from "./database.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

function seed(path, value) {
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE model_metadata(id INTEGER PRIMARY KEY, document_present INTEGER); INSERT INTO model_metadata VALUES(1,1); CREATE TABLE facts(value TEXT)",
  );
  db.prepare("INSERT INTO facts VALUES(?)").run(value);
  return db;
}

test("online snapshot includes committed WAL data, excludes uncommitted rows, and stays private", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "waypoint-snapshot-"));
  const source = resolve(dir, "source.db");
  const target = resolve(dir, "copy.db");
  const writer = seed(source, "committed");
  try {
    writer.exec("BEGIN; INSERT INTO facts VALUES('uncommitted')");
    await snapshotFile(source, target);
    validateSnapshot(target);
    const copy = new DatabaseSync(target, { readOnly: true });
    try {
      assert.deepEqual(
        copy
          .prepare("SELECT value FROM facts")
          .all()
          .map((row) => row.value),
        ["committed"],
      );
    } finally {
      copy.close();
    }
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    writer.exec("ROLLBACK");
    assert.equal(writer.prepare("SELECT COUNT(*) AS n FROM facts").get().n, 1);
    await assert.rejects(() => snapshotFile(source, target), { code: "EEXIST" });
  } finally {
    writer.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid sources do not leave an accepted snapshot or overwrite an existing file", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "waypoint-invalid-snapshot-"));
  try {
    const source = resolve(dir, "invalid.db");
    const target = resolve(dir, "copy.db");
    await writeFile(source, "not SQLite");
    await assert.rejects(() => snapshotFile(source, target));
    await assert.rejects(() => stat(target), { code: "ENOENT" });
    assert.equal(await readFile(source, "utf8"), "not SQLite");
    await assert.rejects(() => snapshotFile(source, source), /must differ/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("application snapshot includes multiple plans and identity state in one file", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "waypoint-application-snapshot-"));
  const source = resolve(dir, "app.db");
  const writer = new DatabaseSync(source);
  writer.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE plans(id TEXT); INSERT INTO plans VALUES('owner'),('second'),('plans/sample'); CREATE TABLE model_metadata(plan_id TEXT, id INTEGER, document_present INTEGER); INSERT INTO model_metadata VALUES('owner',1,1),('second',1,1),('plans/sample',1,1); CREATE TABLE identity_grants(data TEXT); INSERT INTO identity_grants VALUES('sealed grant');",
  );
  try {
    const target = resolve(dir, "snapshot.db");
    await snapshotFile(source, target);
    const sample = new DatabaseSync(target, { readOnly: true });
    try {
      assert.equal(sample.prepare("SELECT COUNT(*) AS n FROM plans").get().n, 3);
      assert.equal(sample.prepare("SELECT data FROM identity_grants").get().data, "sealed grant");
    } finally {
      sample.close();
    }
  } finally {
    writer.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("explicit setup provisions an empty application snapshot and repeat setup preserves identity state", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "waypoint-setup-"));
  const source = resolve(dir, "new", "app.db");
  const binary = resolve(dir, "setupdb");
  try {
    await exec("go", ["-C", resolve(root, "backend"), "build", "-o", binary, "./cmd/setupdb"]);
    await exec(binary, ["--db", source]);
    assert.equal(validateSnapshot(source), "application");
    const first = new DatabaseSync(source);
    try {
      assert.equal(first.prepare("SELECT COUNT(*) AS n FROM plans").get().n, 0);
      for (const table of [
        "sessions",
        "identity_grants",
        "identity_logout_marks",
        "identity_logout_tokens",
      ]) {
        assert.equal(first.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
      }
      first.exec("INSERT INTO sessions VALUES('cookie', X'0100', 999)");
    } finally {
      first.close();
    }
    await exec(binary, ["--db", source]);
    const target = resolve(dir, "snapshot.db");
    await snapshotFile(source, target);
    const copy = new DatabaseSync(target, { readOnly: true });
    try {
      assert.equal(copy.prepare("SELECT token FROM sessions").get().token, "cookie");
    } finally {
      copy.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
