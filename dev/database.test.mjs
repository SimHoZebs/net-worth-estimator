import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { databaseName, installSnapshot, snapshotFile, validateSnapshot } from './database.mjs';

function seed(path, value) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE model_metadata(id INTEGER PRIMARY KEY, document_present INTEGER); INSERT INTO model_metadata VALUES(1,1); CREATE TABLE facts(value TEXT)');
  db.prepare('INSERT INTO facts VALUES(?)').run(value);
  return db;
}

test('online snapshot includes committed WAL data, excludes uncommitted rows, and stays private', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'waypoint-snapshot-'));
  const source = resolve(dir, 'source.db');
  const target = resolve(dir, 'copy.db');
  const writer = seed(source, 'committed');
  try {
    writer.exec("BEGIN; INSERT INTO facts VALUES('uncommitted')");
    await snapshotFile(source, target);
    validateSnapshot(target);
    const copy = new DatabaseSync(target, { readOnly: true });
    try { assert.deepEqual(copy.prepare('SELECT value FROM facts').all().map((row) => row.value), ['committed']); }
    finally { copy.close(); }
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    writer.exec('ROLLBACK');
    assert.equal(writer.prepare('SELECT COUNT(*) AS n FROM facts').get().n, 1);
    await assert.rejects(() => snapshotFile(source, target), { code: 'EEXIST' });
  } finally { writer.close(); await rm(dir, { recursive: true, force: true }); }
});

test('invalid sources do not leave an accepted snapshot or overwrite an existing file', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'waypoint-invalid-snapshot-'));
  try {
    const source = resolve(dir, 'invalid.db');
    const target = resolve(dir, 'copy.db');
    await writeFile(source, 'not SQLite');
    await assert.rejects(() => snapshotFile(source, target));
    await assert.rejects(() => stat(target), { code: 'ENOENT' });
    assert.equal(await readFile(source, 'utf8'), 'not SQLite');
    await assert.rejects(() => snapshotFile(source, source), /must differ/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('financial refresh backs up the prior model and leaves identity storage untouched', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'waypoint-refresh-'));
  const data = resolve(dir, 'data');
  const backups = resolve(dir, 'backups');
  await mkdir(data);
  seed(resolve(data, databaseName), 'old model').close();
  seed(resolve(dir, 'incoming.db'), 'new model').close();
  await writeFile(resolve(data, 'identity.db'), 'persistent sessions');
  try {
    await installSnapshot(resolve(dir, 'incoming.db'), data, backups);
    const current = new DatabaseSync(resolve(data, databaseName), { readOnly: true });
    try { assert.equal(current.prepare('SELECT value FROM facts').get().value, 'new model'); }
    finally { current.close(); }
    const files = (await readdir(backups)).filter((file) => file.endsWith('.db'));
    assert.equal(files.length, 1);
    const prior = new DatabaseSync(resolve(backups, files[0]), { readOnly: true });
    try { assert.equal(prior.prepare('SELECT value FROM facts').get().value, 'old model'); }
    finally { prior.close(); }
    assert.equal(await readFile(resolve(data, 'identity.db'), 'utf8'), 'persistent sessions');
    await writeFile(resolve(dir, 'bad.db'), 'invalid');
    await assert.rejects(() => installSnapshot(resolve(dir, 'bad.db'), data, backups));
    validateSnapshot(resolve(data, databaseName));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
