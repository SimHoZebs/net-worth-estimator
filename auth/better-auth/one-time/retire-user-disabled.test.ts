import { test, expect } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { setup } from "../src/setup";
import { retireUserDisabled } from "./retire-user-disabled";

const config = (database: string) => ({
  issuer: "http://localhost:9800",
  appUrl: "http://localhost:9801",
  database,
  secret: "auth-secret-123456789012345678901234",
  clientId: "waypoint",
  clientSecret: "client-secret-123456789012345678901234",
  backchannelUrl: undefined,
});

// Existing targets carry the retired flag as NOT NULL with no default, which is
// exactly the shape that makes Better Auth reject every API call.
async function legacyIdentity(dir: string) {
  const database = join(dir, "identity.db");
  await setup(config(database));
  const db = new Database(database, { create: false, strict: true });
  try {
    db.exec('ALTER TABLE "user" ADD COLUMN disabled integer not null');
    const insert = db.query(
      'INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt,username,displayUsername,disabled) VALUES (?,?,?,?,?,?,?,?,?)',
    );
    insert.run("owner-1", "Owner", "owner@example.test", 0, 1, 1, "owner", "owner", 0);
    insert.run("guest-1", "Guest", "guest@example.test", 0, 1, 1, null, null, 1);
  } finally {
    db.close();
  }
  return database;
}

function columns(database: string) {
  const db = new Database(database, { readonly: true, strict: true });
  try {
    return db
      .query("SELECT name FROM pragma_table_info('user')")
      .all()
      .map((row) => (row as { name: string }).name);
  } finally {
    db.close();
  }
}

function users(database: string) {
  const db = new Database(database, { readonly: true, strict: true });
  try {
    return db.query('SELECT id, username FROM "user" ORDER BY id').all();
  } finally {
    db.close();
  }
}

test("retires the disabled column and keeps every user", async () => {
  const dir = await mkdtemp(join(tmpdir(), "waypoint-retire-"));
  try {
    const database = await legacyIdentity(dir);
    const before = users(database);
    expect(columns(database)).toContain("disabled");

    const dry = await retireUserDisabled(database, { apply: false });
    expect(dry).toMatchObject({ database: "sqlite", present: true, rowCount: 2 });
    expect(columns(database)).toContain("disabled");

    const plan = await retireUserDisabled(database, { apply: true });
    expect(plan.present).toBe(true);
    expect(plan.backup).toBeString();
    expect(columns(database)).not.toContain("disabled");
    expect(users(database)).toEqual(before);
    expect(await readdir(dir)).toContain(plan.backup!.split("/").pop()!);

    const again = await retireUserDisabled(database, { apply: true });
    expect(again.present).toBe(false);
    expect(sequences(await readdir(dir), plan.backup!)).toBe(1);
    expect(users(database)).toEqual(before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("refuses a database that is not the identity schema", async () => {
  const dir = await mkdtemp(join(tmpdir(), "waypoint-retire-"));
  try {
    const database = join(dir, "foreign.db");
    const db = new Database(database, { create: true, strict: true });
    try {
      db.exec('CREATE TABLE "user" (id text not null primary key)');
    } finally {
      db.close();
    }
    await expect(retireUserDisabled(database, { apply: true })).rejects.toThrow(
      "identity database is missing its current tables",
    );
    expect(columns(database)).not.toContain("disabled");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("refuses a database with an active writer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "waypoint-retire-"));
  try {
    const database = await legacyIdentity(dir);
    await writeFile(`${database}-wal`, "");
    await expect(retireUserDisabled(database, { apply: false })).rejects.toThrow("not quiescent");
    expect(columns(database)).toContain("disabled");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("postgres requires the verified backup name before applying", async () => {
  await expect(
    retireUserDisabled("postgresql://user:pass@127.0.0.1:1/identity", { apply: true }),
  ).rejects.toThrow("requires --backup");
});

function sequences(files: string[], backup: string) {
  const prefix = backup.split("/").pop()!;
  return files.filter((file) => file.startsWith(prefix.split("-").slice(0, -1).join("-"))).length;
}
