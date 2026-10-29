import { DatabaseSync, backup } from "node:sqlite";
import { open, chmod, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { runIfCli } from "./lib/entry.mjs";

export const databaseName = "net-worth-estimator.db";

export function validateSnapshot(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok") {
      throw new Error("SQLite snapshot failed its integrity check");
    }
    const scoped = db
      .prepare("PRAGMA table_info(model_metadata)")
      .all()
      .some((column) => column.name === "account_id");
    if (scoped) {
      // An empty application database is valid. Account ownership is separate
      // from financial document presence, and identity tables share this backup.
      db.prepare("SELECT id FROM app_accounts LIMIT 1").all();
      return "application";
    }
    if (
      db.prepare("SELECT document_present FROM model_metadata WHERE id=1").get()
        ?.document_present !== 1
    ) {
      throw new Error("The source database has no financial model");
    }
    return "legacy";
  } finally {
    db.close();
  }
}

// SQLite's backup API includes committed WAL pages without pausing the source.
export async function snapshotFile(source, destination) {
  if (resolve(source) === resolve(destination))
    throw new Error("Snapshot source and destination must differ");
  const file = await open(destination, "wx", 0o600);
  await file.close();
  let db;
  try {
    db = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
    await backup(db, destination);
    await chmod(destination, 0o600);
    validateSnapshot(destination);
  } catch (error) {
    await unlink(destination);
    throw error;
  } finally {
    db?.close();
  }
}

async function cli(args) {
  process.umask(0o077);
  const [source, destination] = args;
  if (!source || !destination) throw new Error("Usage: snapshot.mjs SOURCE_DB DESTINATION_DB");
  const target = destination === "--stdout" ? "/tmp/snapshot.db" : destination;
  await snapshotFile(source, target);
  if (destination === "--stdout") await pipeline(createReadStream(target), process.stdout);
}

runIfCli(import.meta.url, process.argv, cli);
