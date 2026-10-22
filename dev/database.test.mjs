import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { databaseName, installSnapshot, sampleDatabaseName, sampleSnapshot, snapshotFile, validateSnapshot } from './database.mjs';

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

test('sample publication isolates canonical data and omits private artifact and bridge history', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'waypoint-sample-'));
  const data = resolve(dir, 'data');
  await mkdir(data);
  const source = resolve(data, databaseName);
  const writer = seed(source, 'owner financial data');
  writer.exec("ALTER TABLE model_metadata ADD COLUMN source_path TEXT DEFAULT 'private/path'; CREATE TABLE projection_artifacts(payload TEXT); INSERT INTO projection_artifacts VALUES('private unsaved scenario'); CREATE TABLE account_links(bridge_account_id TEXT); INSERT INTO account_links VALUES('private-bridge-id'); CREATE TABLE sync_state(last_sync_at TEXT); INSERT INTO sync_state VALUES('2026-01-01');");
  writer.exec("CREATE TABLE posting_sync_keys(provider TEXT, transaction_id TEXT); INSERT INTO posting_sync_keys VALUES('bank', 'private-upstream-key'); CREATE TABLE posting_id_migrations(old_id TEXT, new_id TEXT); INSERT INTO posting_id_migrations VALUES('private-legacy-id', 'uuid');");
  const incoming = resolve(dir, 'incoming.db');
  await writeFile(resolve(data, 'identity.db'), 'owner sessions');
  try {
    await sampleSnapshot(source, incoming);
    await installSnapshot(incoming, data, resolve(dir, 'backups'), sampleDatabaseName);
    const sample = new DatabaseSync(resolve(data, sampleDatabaseName), { readOnly: true });
    try {
      assert.equal(sample.prepare('SELECT value FROM facts').get().value, 'owner financial data');
      assert.equal(sample.prepare('SELECT COUNT(*) AS n FROM projection_artifacts').get().n, 0);
      assert.equal(sample.prepare('SELECT COUNT(*) AS n FROM account_links').get().n, 0);
      assert.equal(sample.prepare('SELECT COUNT(*) AS n FROM posting_sync_keys').get().n, 0);
      assert.equal(sample.prepare('SELECT COUNT(*) AS n FROM posting_id_migrations').get().n, 0);
      assert.equal(sample.prepare('SELECT source_path FROM model_metadata').get().source_path, 'sample');
      assert.equal(sample.prepare('SELECT last_sync_at FROM sync_state').get().last_sync_at, '');
    } finally { sample.close(); }
    assert.equal(writer.prepare('SELECT COUNT(*) AS n FROM projection_artifacts').get().n, 1);
    assert.equal(writer.prepare('SELECT COUNT(*) AS n FROM account_links').get().n, 1);
    assert.equal(await readFile(resolve(data, 'identity.db'), 'utf8'), 'owner sessions');
    await assert.rejects(() => installSnapshot(source, data, resolve(dir, 'backups'), '../escape.db'), /destination/);
  } finally { writer.close(); await rm(dir, { recursive: true, force: true }); }
});
