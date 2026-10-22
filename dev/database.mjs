import { DatabaseSync, backup } from 'node:sqlite';
import { open, chmod, unlink, mkdir, rename, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

export const databaseName = 'net-worth-estimator.db';

export function validateSnapshot(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') {
      throw new Error('SQLite snapshot failed its integrity check');
    }
    if (db.prepare('SELECT document_present FROM model_metadata WHERE id=1').get()?.document_present !== 1) {
      throw new Error('The source database has no financial model');
    }
  } finally {
    db.close();
  }
}

// SQLite's backup API includes committed WAL pages without pausing the source.
export async function snapshotFile(source, destination) {
  if (resolve(source) === resolve(destination)) throw new Error('Snapshot source and destination must differ');
  const file = await open(destination, 'wx', 0o600);
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

export async function installSnapshot(incoming, dataDir, backupDir) {
  validateSnapshot(incoming);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const destination = resolve(dataDir, databaseName);
  let present = true;
  try { await stat(destination); } catch (error) { if (error.code === 'ENOENT') present = false; else throw error; }
  if (present) {
    // The dev API is stopped before replacement. Make the old main file safe
    // even if the process dies between sidecar cleanup and the atomic rename.
    const db = new DatabaseSync(destination, { timeout: 5000 });
    try {
      if (db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy !== 0) throw new Error('The dev database is still in use');
    } finally { db.close(); }
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    await snapshotFile(destination, resolve(backupDir, `dev-${Date.now()}-${randomUUID()}.db`));
  }
  for (const suffix of ['-wal', '-shm']) {
    await unlink(destination + suffix).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  await rename(incoming, destination);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw new Error('Usage: snapshot.mjs SOURCE_DB DESTINATION_DB');
  const target = destination === '--stdout' ? '/tmp/snapshot.db' : destination;
  await snapshotFile(source, target);
  if (destination === '--stdout') await pipeline(createReadStream(target), process.stdout);
}
