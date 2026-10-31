import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";

const run = promisify(execFile);
const script = new URL("./migrate.sh", import.meta.url);
const readJSON = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

const tools = await mkdtemp(join(tmpdir(), "waypoint-migration-tools-"));
after(() => rm(tools, { recursive: true, force: true }));
await run("go", ["build", "-o", join(tools, "setupdb"), "./cmd/setupdb"], {
  cwd: new URL("../backend/", import.meta.url).pathname,
  env: { ...process.env, CGO_ENABLED: "0" },
});
await run("go", ["build", "-o", join(tools, "upgrade-posting-sim-split"), "./scripts/one-time/posting-sim-split"], {
  cwd: new URL("../backend/", import.meta.url).pathname,
  env: { ...process.env, CGO_ENABLED: "0" },
});
await run("go", ["build", "-o", join(tools, "upgrade-planned-purchases"), "./scripts/one-time/planned-purchases"], {
  cwd: new URL("../backend/", import.meta.url).pathname,
  env: { ...process.env, CGO_ENABLED: "0" },
});

const sqlite = (db, sql) => run("sqlite3", [db, sql]);
const rows = async (db, sql) => (await sqlite(db, sql)).stdout.trim();
const sha256File = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const migrate = (db, extraEnv) => run("/bin/sh", [script.pathname], {
  env: { ...process.env, PATH: `${tools}${delimiter}${process.env.PATH}`, ...extraEnv, NET_WORTH_ESTIMATOR_DB: db },
});
const migrateFails = async (db, extraEnv) => {
  const error = await migrate(db, extraEnv).then(
    () => null,
    (failure) => failure,
  );
  assert.ok(error, `migration unexpectedly succeeded for ${db}`);
  return error;
};
const backups = async (directory) => (await readdir(directory)).filter((name) => name.includes(".analysis-backup."));

const DAY_CLOSE_0310 = 1773187199; // 2026-03-10 23:59:59 UTC
const DAY_CLOSE_0311 = 1773273599; // 2026-03-11 23:59:59 UTC

// Full current base from this image's setupdb, with one owner user.
async function fullBase(directory, name = "application.db") {
  const db = join(directory, name);
  await run(join(tools, "setupdb"), ["--db", db, "--issuer", "https://fixture.invalid", "--subject", "owner"]);
  const owner = await rows(db, "SELECT id FROM users;");
  return { db, owner };
}

// Rebuild checkpoints into the exact deployed date-only shape (date 4th),
// keeping the readable fields. With strip=false the Analysis schema stays,
// modelling an already-Analysis date source.
async function toLegacyCheckpoints(db, stripAnalysis = true) {
  const analysis = stripAnalysis ? `DROP TRIGGER IF EXISTS analysis_posting_lifecycle;
    DROP TRIGGER IF EXISTS analysis_posting_sim_lifecycle;
    DROP TRIGGER IF EXISTS analysis_facts_insert;
    DROP TRIGGER IF EXISTS analysis_facts_update;
    DROP TRIGGER IF EXISTS analysis_facts_delete;
    DROP TABLE IF EXISTS analysis_feedback; DROP TABLE IF EXISTS analysis_findings;
    DROP TABLE IF EXISTS analysis_runs; DROP TABLE IF EXISTS transaction_source_facts;
    DROP TABLE IF EXISTS analysis_inputs;
    DELETE FROM schema_migrations WHERE name IN ('transaction-analysis-v1','analysis-feedback-v1');` : "";
  await sqlite(db, `${analysis}
    DROP TABLE checkpoints;
    CREATE TABLE checkpoints(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id INTEGER NOT NULL, position INTEGER NOT NULL, date TEXT NOT NULL, model_account_id TEXT NOT NULL, balance REAL NOT NULL, source TEXT NOT NULL DEFAULT 'user', PRIMARY KEY(user_id, id), UNIQUE(user_id, model_account_id, date));`);
}

async function seedBankRows(db, owner, extraUser) {
  await sqlite(db, `INSERT INTO accounts(user_id, id, position, name, kind, enabled) VALUES
    ('${owner}', 'checking', 0, 'Checking', 'cash', 1),
    ('${extraUser}', 'checking', 0, 'Checking', 'cash', 1);`);
  await sqlite(db, `INSERT INTO checkpoints(user_id, id, position, date, model_account_id, balance, source) VALUES
    ('${owner}', 1, 0, '2026-03-10', 'checking', 100, 'user'),
    ('${extraUser}', 1, 0, '2026-03-10', 'checking', 300, 'simplefin'),
    ('${owner}', 3, 2, '2026-03-11', 'checking', 150, 'user');`);
  await sqlite(db, `INSERT INTO postings(user_id, id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, void) VALUES
    ('${owner}', 'settled-a', 'Groceries', 'checking', 'null', '{}', 1773140400, 1773129600, 'simplefin', 0, 0),
    ('${owner}', 'pending-a', 'Hold', 'checking', 'null', '{}', 1773140400, 1773129600, 'simplefin', 1, 0),
    ('${owner}', 'void-a', 'Vanished', 'checking', 'null', '{}', 1773140400, 1773129600, 'simplefin', 0, 1),
    ('${owner}', 'manual-a', 'Owner', 'checking', 'null', '{}', 1773140400, 1773129600, 'user', 0, 0),
    ('${extraUser}', 'settled-b', 'Fuel', 'checking', 'null', '{}', 1773140400, 1773129600, 'simplefin', 0, 0);`);
  await sqlite(db, `INSERT INTO posting_sim(user_id, posting_id, position, enabled, execution_order) VALUES
    ('${owner}', 'settled-a', 0, 0, 1),
    ('${owner}', 'pending-a', 1, 0, 2),
    ('${owner}', 'void-a', 2, 0, 3),
    ('${owner}', 'manual-a', 3, 0, 4),
    ('${extraUser}', 'settled-b', 0, 0, 1);`);
  await sqlite(db, `INSERT INTO posting_sync_keys(user_id, provider, bridge_account_id, transaction_id, posting_id) VALUES
    ('${owner}', 'simplefin', 'bridge-checking', 'tx1', 'settled-a'),
    ('${extraUser}', 'simplefin', 'bridge-checking', 'tx2', 'settled-b');`);
  await sqlite(db, `INSERT INTO projection_artifacts(user_id, identity, kind, payload) VALUES ('${owner}', 'note-1', 'note', 'private-note');`);
  await sqlite(db, `INSERT INTO blob_objects(key,state,expires_at) VALUES ('receipt-blob','live',0);
    INSERT INTO blob_data(key,data) VALUES ('receipt-blob',X'000102FF');
    INSERT INTO receipts(user_id,id,posting_id,digest,size,blob_key,revision,payload) VALUES ('${owner}','receipt-1','settled-a','synthetic-digest',4,'receipt-blob',3,'{"privateNote":"retained synthetic attachment"}');
    `);
}

const privateAttachments = (db) => rows(db, `SELECT user_id,id,posting_id,digest,size,blob_key,revision,payload FROM receipts ORDER BY user_id,id;
  SELECT key,state,expires_at FROM blob_objects ORDER BY key;
  SELECT key,hex(data) FROM blob_data ORDER BY key;`);

async function secondUser(db) {
  await sqlite(db, "INSERT INTO users(id, issuer, subject) VALUES ('user:b', 'https://fixture.invalid', 'guest');");
  return "user:b";
}

async function seedAnalysisChain(db, owner) {
  await sqlite(db, `INSERT INTO transaction_source_facts(user_id, posting_id, facts_json) VALUES ('${owner}', 'settled-a', '{"bridge":"facts"}');`);
  // The facts trigger already seeds this user's inputs row; set the revision.
  await sqlite(db, `UPDATE analysis_inputs SET revision = 3 WHERE user_id = '${owner}';`);
  await sqlite(db, `INSERT INTO analysis_runs(user_id, id, type, version, input_revision, state, started_at, completed_at, lease_until, problem, input_json)
    VALUES ('${owner}', 'run-1', 'bnpl', 'v1', 3, 'complete', 100, 200, 0, '', '{}');`);
  await sqlite(db, `INSERT INTO analysis_findings(user_id, id, analysis_type, posting_id, kind, detection_json, run_id, first_detected_at, last_checked_at, status, dismissed, review_json, feedback_revision)
    VALUES ('${owner}', 'f-1', 'bnpl', 'settled-a', 'bnpl', '{}', 'run-1', 100, 150, 'active', 0, 'null', 0);`);
  await sqlite(db, `INSERT INTO analysis_feedback(user_id, id, request_id, finding_id, run_id, created_at, payload_json)
    VALUES ('${owner}', 'fb-1', 'req-1', 'f-1', 'run-1', 160, '{"verdict":"confirm"}');`);
}

const analysisSnapshot = async (db) => rows(db, `SELECT user_id, posting_id, facts_json FROM transaction_source_facts ORDER BY 1, 2;
  SELECT user_id, revision FROM analysis_inputs ORDER BY 1;
  SELECT user_id, id, type, version, input_revision, state, started_at, completed_at, lease_until, problem, input_json FROM analysis_runs ORDER BY 1, 2;
  SELECT user_id, id, analysis_type, posting_id, kind, detection_json, run_id, first_detected_at, last_checked_at, status, dismissed, review_json, feedback_revision FROM analysis_findings ORDER BY 1, 2;
  SELECT user_id, id, request_id, finding_id, run_id, created_at, payload_json FROM analysis_feedback ORDER BY 1, 2;`);

test("one-time audit-table removal preserves all current data and the backup", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-migration-audit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { db, owner } = await fullBase(directory);
  await sqlite(db, `INSERT INTO accounts(user_id,id,position,name,kind,enabled) VALUES ('${owner}','checking',0,'Checking','cash',1);
    INSERT INTO sessions VALUES('session',X'0102',999);`);
  const expected = (await sqlite(db, ".dump")).stdout;
  await sqlite(db, `CREATE TABLE posting_id_migrations(user_id TEXT NOT NULL, old_id TEXT NOT NULL, new_id TEXT NOT NULL, PRIMARY KEY(user_id,old_id));
    INSERT INTO posting_id_migrations VALUES ('${owner}','opening','01900000-0000-7000-8000-000000000001');`);

  await migrate(db);

  assert.equal((await sqlite(db, ".dump")).stdout, expected);
  const saved = await backups(directory);
  assert.equal(saved.length, 1);
  assert.equal(await rows(join(directory, saved[0], "before.db"), "SELECT count(*) FROM posting_id_migrations;"), "1");
  const completed = await sha256File(db);
  await migrate(db);
  assert.equal(await sha256File(db), completed);
  assert.deepEqual(await backups(directory), saved);
});

test("legacy date checkpoints convert and Analysis provisions on a full base", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-migration-convert-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { db, owner } = await fullBase(directory);
  const guest = await secondUser(db);
  await toLegacyCheckpoints(db);
  await seedBankRows(db, owner, guest);
  const metaBefore = await rows(db, "SELECT id, issuer, subject FROM users ORDER BY id; SELECT * FROM model_metadata;");
  const keysBefore = await rows(db, "SELECT user_id, provider, bridge_account_id, transaction_id, posting_id FROM posting_sync_keys ORDER BY 1, 2, 3, 4;");
  const attachmentsBefore = await privateAttachments(db);

  const result = await migrate(db);
  assert.match(result.stdout, /Converted legacy checkpoints/);

  assert.equal(await rows(db, "SELECT observed_at FROM checkpoints WHERE user_id = 'user:b';"), `${DAY_CLOSE_0310}`);
  assert.deepEqual((await rows(db, "SELECT user_id, id, position, model_account_id, balance, source, observed_at FROM checkpoints ORDER BY user_id, id;")).split("\n"), [
    `user:b|1|0|checking|300.0|simplefin|${DAY_CLOSE_0310}`,
    `${owner}|1|0|checking|100.0|user|${DAY_CLOSE_0310}`,
    `${owner}|3|2|checking|150.0|user|${DAY_CLOSE_0311}`,
  ]);
  assert.deepEqual((await rows(db, "SELECT p.user_id || '/' || p.id, s.enabled || '/' || p.transaction_time FROM postings p JOIN posting_sim s ON s.user_id=p.user_id AND s.posting_id=p.id ORDER BY 1;")).split("\n"), [
    `user:b/settled-b|1/1773140400`,
    `${owner}/manual-a|0/1773129600`,
    `${owner}/pending-a|0/1773129600`,
    `${owner}/settled-a|1/1773140400`,
    `${owner}/void-a|0/1773129600`,
  ]);
  assert.equal(await rows(db, "SELECT user_id, provider, bridge_account_id, transaction_id, posting_id FROM posting_sync_keys ORDER BY 1, 2, 3, 4;"), keysBefore);
  assert.equal(await privateAttachments(db), attachmentsBefore);
  assert.equal(await rows(db, "SELECT id, issuer, subject FROM users ORDER BY id; SELECT * FROM model_metadata;"), metaBefore);
  assert.equal(await rows(db, "PRAGMA integrity_check;"), "ok");
  assert.equal(await rows(db, "SELECT COUNT(*) FROM pragma_foreign_key_check;"), "0");
  assert.equal(await rows(db, "SELECT COUNT(*) FROM analysis_feedback;"), "0");
  assert.equal(await rows(db, "SELECT COUNT(*) FROM schema_migrations WHERE name IN ('transaction-analysis-v1','analysis-feedback-v1');"), "2");

  const names = await backups(directory);
  assert.equal(names.length, 1);
  const backup = join(directory, names[0], "before.db");
  assert.equal((await stat(backup)).mode & 0o077, 0);
  assert.equal(await privateAttachments(backup), attachmentsBefore);
});

test("already-Analysis date source converts with byte-identical Analysis rows", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-migration-analyzed-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { db, owner } = await fullBase(directory);
  const guest = await secondUser(db);
  await toLegacyCheckpoints(db, false);
  await seedBankRows(db, owner, guest);
  await seedAnalysisChain(db, owner);
  const analysisBefore = await analysisSnapshot(db);

  await migrate(db);

  assert.equal(await rows(db, "SELECT observed_at FROM checkpoints ORDER BY user_id, id LIMIT 1;"), `${DAY_CLOSE_0310}`);
  assert.equal(await rows(db, "SELECT s.enabled, p.transaction_time FROM postings p JOIN posting_sim s ON s.user_id=p.user_id AND s.posting_id=p.id WHERE p.id = 'settled-a';"), "1|1773140400");
  assert.equal(await analysisSnapshot(db), analysisBefore);
  assert.equal(await rows(db, "PRAGMA integrity_check;"), "ok");
  assert.equal(await rows(db, "SELECT COUNT(*) FROM pragma_foreign_key_check;"), "0");
});

test("complete target repeats read-only and preserves owner disables byte-identical", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-migration-repeat-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { db, owner } = await fullBase(directory);
  const guest = await secondUser(db);
  await toLegacyCheckpoints(db);
  await seedBankRows(db, owner, guest);
  await migrate(db);
  await sqlite(db, `UPDATE posting_sim SET enabled = 0 WHERE user_id = '${owner}' AND posting_id = 'settled-a';`);
  await seedAnalysisChain(db, owner);
  const hashBefore = await sha256File(db);
  const analysisBefore = await analysisSnapshot(db);
  const backupsBefore = await backups(directory);

  const result = await migrate(db);
  assert.match(result.stdout, /verified, nothing to do/);
  assert.equal(await sha256File(db), hashBefore);
  assert.deepEqual(await backups(directory), backupsBefore);
  assert.equal(await analysisSnapshot(db), analysisBefore);
  assert.equal(await rows(db, `SELECT enabled FROM posting_sim WHERE user_id = '${owner}' AND posting_id = 'settled-a';`), "0");
});

test("complete target verification leaves committed WAL data untouched", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-migration-wal-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { db } = await fullBase(directory);
  // A disposable killed writer leaves a valid committed WAL without a live
  // connection. A read-write inspection could checkpoint it on close.
  await assert.rejects(run(process.execPath, ["--input-type=module", "-e", `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO accounts(user_id,id,position,name,kind,enabled) SELECT id,'wal-asset',0,'Retained WAL asset','cash',1 FROM users;");
    process.kill(process.pid, 'SIGKILL');
  `, db]), (error) => error.signal === "SIGKILL");
  const before = await sha256File(db);
  const walBefore = await sha256File(db + "-wal");
  await migrate(db);
  assert.equal(await sha256File(db), before);
  assert.equal(await sha256File(db + "-wal"), walBefore);
  assert.deepEqual(await backups(directory), []);
});

test("legacy conversion publishes committed WAL data and retains its verified backup", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-migration-convert-wal-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { db, owner } = await fullBase(directory);
  const guest = await secondUser(db);
  await toLegacyCheckpoints(db);
  await seedBankRows(db, owner, guest);
  const attachmentsBefore = await privateAttachments(db);
  await assert.rejects(run(process.execPath, ["--input-type=module", "-e", `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE checkpoints SET balance=125 WHERE id=1 AND source='user';");
    process.kill(process.pid, 'SIGKILL');
  `, db]), (error) => error.signal === "SIGKILL");
  assert.ok((await stat(db + "-wal")).size > 0);
  await migrate(db);
  assert.equal(await rows(db, `SELECT balance,observed_at FROM checkpoints WHERE user_id='${owner}' AND id=1;`), `125.0|${DAY_CLOSE_0310}`);
  assert.equal(await rows(db, `SELECT s.enabled,p.transaction_time FROM postings p JOIN posting_sim s ON s.user_id=p.user_id AND s.posting_id=p.id WHERE p.user_id='${owner}' AND p.id='settled-a';`), "1|1773140400");
  assert.equal(await rows(db, "PRAGMA integrity_check;"), "ok");
  assert.equal(await rows(db, "SELECT count(*) FROM pragma_foreign_key_check;"), "0");
  assert.equal(await privateAttachments(db), attachmentsBefore);
  const names = await backups(directory);
  assert.equal(names.length, 1);
  const backup = join(directory, names[0], "before.db");
  assert.equal(await rows(backup, `SELECT balance,date FROM checkpoints WHERE user_id='${owner}' AND id=1;`), "125.0|2026-03-10");
  assert.equal(await rows(backup, "PRAGMA integrity_check;"), "ok");
  assert.equal(await privateAttachments(backup), attachmentsBefore);
});

test("candidate verification rejects lost bank identities and a changed checkpoint schema", async (t) => {
  for (const [name, sabotage, pattern] of [
    ["bank-identity", "UPDATE postings SET id='replacement' WHERE id='unlinked-bank';", /Candidate setup changed schema or rows/],
    ["checkpoint-schema", "ALTER TABLE checkpoints RENAME COLUMN observed_at TO wrong_instant;", /Candidate setup changed schema or rows/],
  ]) {
    const directory = await mkdtemp(join(tmpdir(), `waypoint-migration-candidate-${name}-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { db, owner } = await fullBase(directory);
    const guest = await secondUser(db);
    await toLegacyCheckpoints(db);
    await seedBankRows(db, owner, guest);
    await sqlite(db, `INSERT INTO postings(user_id,id,name,source_account_id,destination_account_ids,amount_resolution_json,posted_time,transaction_time,source,pending,void) VALUES ('${owner}','unlinked-bank','Bank record without a sync key','checking','null','{}',1773140400,1773129600,'simplefin',0,0);
    INSERT INTO posting_sim(user_id,posting_id,position,enabled,execution_order) VALUES ('${owner}','unlinked-bank',9,0,0);`);
    const stub = join(directory, "setupdb");
    await writeFile(stub, `#!/bin/sh\n"${join(tools, "setupdb")}" "$@" || exit $?\nsqlite3 "$2" "${sabotage}"\n`, { mode: 0o700 });
    const before = await sha256File(db);
    await assert.rejects(migrate(db, { PATH: directory + delimiter + tools + delimiter + process.env.PATH }), pattern);
    assert.equal(await sha256File(db), before);
    assert.equal((await backups(directory)).length, 1);
  }
});

test("invalid dates, posted instants, and shapes fail closed with the original unchanged", async (t) => {
  const templateDir = await mkdtemp(join(tmpdir(), "waypoint-migration-template-"));
  t.after(() => rm(templateDir, { recursive: true, force: true }));
  const { db: template, owner } = await fullBase(templateDir);
  const guest = await secondUser(template);
  await toLegacyCheckpoints(template);
  await seedBankRows(template, owner, guest);

  const cases = [
    ["bad-date", `UPDATE checkpoints SET date = 'not-a-date' WHERE id = 1 AND user_id = '${owner}';`, /invent timestamps/],
    ["normalized-date", `UPDATE checkpoints SET date = '2026-02-30' WHERE id = 1 AND user_id = '${owner}';`, /invent timestamps/],
    ["zero-posted", `UPDATE postings SET posted_time = 0 WHERE id = 'settled-a';`, /posted instant/],
    ["text-posted", `UPDATE postings SET posted_time = 'not-a-time' WHERE id = 'settled-a';`, /posted instant/],
    ["mixed-shape", `ALTER TABLE checkpoints ADD COLUMN observed_at INTEGER NOT NULL DEFAULT 0;`, /unexpected shape/],
    ["partial-analysis", `CREATE TABLE analysis_inputs(user_id TEXT PRIMARY KEY, revision INTEGER);`, /Partial Analysis/],
    ["missing-marker", `DELETE FROM schema_migrations WHERE name = 'shared-accounts-v1';`, /Unsupported application schema/],
    ["missing-base", `DROP TABLE accounts;`, /integrity check failed/],
  ];
  for (const [name, sabotage, pattern] of cases) {
    const directory = await mkdtemp(join(tmpdir(), `waypoint-migration-reject-${name}-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const db = join(directory, "application.db");
    await run("cp", [template, db]);
    await sqlite(db, sabotage);
    const hashBefore = await sha256File(db);
    const error = await migrateFails(db);
    assert.match(error.stderr, pattern);
    assert.equal(await sha256File(db), hashBefore);
    assert.deepEqual(await backups(directory), []);
  }

  const nullDir = await mkdtemp(join(tmpdir(), "waypoint-migration-reject-null-"));
  t.after(() => rm(nullDir, { recursive: true, force: true }));
  const nullDb = join(nullDir, "application.db");
  await run("cp", [template, nullDb]);
  await sqlite(nullDb, `CREATE TABLE c2(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id INTEGER NOT NULL, position INTEGER NOT NULL, date TEXT, model_account_id TEXT NOT NULL, balance REAL NOT NULL, source TEXT NOT NULL DEFAULT 'user', PRIMARY KEY(user_id, id), UNIQUE(user_id, model_account_id, date));
    INSERT INTO c2 SELECT * FROM checkpoints; DROP TABLE checkpoints; ALTER TABLE c2 RENAME TO checkpoints;`);
  await sqlite(nullDb, `INSERT INTO checkpoints(user_id, id, position, date, model_account_id, balance, source) VALUES ('${owner}', 9, 9, NULL, 'checking', 1, 'user');`);
  const nullHash = await sha256File(nullDb);
  const nullError = await migrateFails(nullDb);
  assert.match(nullError.stderr, /invent timestamps/);
  assert.equal(await sha256File(nullDb), nullHash);
  assert.deepEqual(await backups(nullDir), []);
});

test("absent, foreign, dirty, and unscoped sources fail without creating anything", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-migration-absent-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(migrate(join(directory, "missing.db")), /existing application database/);
  await run("sh", ["-c", `printf 'not a database' > '${join(directory, "garbage.db")}'`]);
  await assert.rejects(migrate(join(directory, "garbage.db")), /Cannot inspect database/);
  assert.deepEqual(await backups(directory), []);

  const quoted = await mkdtemp(join(tmpdir(), "waypoint-migration-quote-"));
  t.after(() => rm(quoted, { recursive: true, force: true }));
  const { db } = await fullBase(quoted);
  const single = join(quoted, "quo'te.db");
  await run("cp", [db, single]);
  await assert.rejects(migrate(single), /single quotes/);
  assert.deepEqual(await backups(quoted), []);

  const journalDir = await mkdtemp(join(tmpdir(), "waypoint-migration-journal-"));
  t.after(() => rm(journalDir, { recursive: true, force: true }));
  const { db: journalDb } = await fullBase(journalDir);
  await run("sh", ["-c", `touch '${journalDb}-journal'`]);
  t.after(() => rm(`${journalDb}-journal`, { force: true }));
  const journalHash = await sha256File(journalDb);
  await assert.rejects(migrate(journalDb), /not quiescent/);
  assert.equal(await sha256File(journalDb), journalHash);
  assert.deepEqual(await backups(journalDir), []);

  const scopeDir = await mkdtemp(join(tmpdir(), "waypoint-migration-scope-"));
  t.after(() => rm(scopeDir, { recursive: true, force: true }));
  const scopeDb = join(scopeDir, "application.db");
  await sqlite(scopeDb, "CREATE TABLE checkpoints(id INTEGER PRIMARY KEY, position INTEGER NOT NULL, date TEXT NOT NULL, model_account_id TEXT NOT NULL, balance REAL NOT NULL, source TEXT NOT NULL DEFAULT 'user');");
  await assert.rejects(migrate(scopeDb), /user scoping|Incomplete application schema/);
  assert.deepEqual(await backups(scopeDir), []);
});

test("mid-transaction failure leaves the original content-identical with the backup retained", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-migration-atomic-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { db, owner } = await fullBase(directory);
  await toLegacyCheckpoints(db);
  await seedBankRows(db, owner, await secondUser(db));
  await sqlite(db, `INSERT INTO checkpoints(user_id, id, position, date, model_account_id, balance, source) VALUES ('${owner}', 7, 7, '2026-03-10', 'ghost', 100, 'user');`);
  const dumpBefore = (await sqlite(db, ".dump")).stdout;
  const error = await migrateFails(db);
  assert.match(error.stderr, /without committing|Original unchanged/);
  assert.equal((await sqlite(db, ".dump")).stdout, dumpBefore);
  assert.equal((await sqlite(db, "SELECT COUNT(*) FROM checkpoints;")).stdout.trim(), "4");
  const names = await backups(directory);
  assert.equal(names.length, 1);
  assert.equal((await sqlite(join(directory, names[0], "before.db"), "SELECT COUNT(*) FROM checkpoints;")).stdout.trim(), "4");
});

test("backups stay private and exclusive across attempts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-migration-backup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { db, owner } = await fullBase(directory);
  await toLegacyCheckpoints(db);
  await seedBankRows(db, owner, await secondUser(db));
  await migrate(db);
  let names = await backups(directory);
  assert.equal(names.length, 1);
  assert.equal((await stat(join(directory, names[0]))).mode & 0o077, 0);
  assert.equal((await stat(join(directory, names[0], "before.db"))).mode & 0o077, 0);
  assert.match(await readFile(join(directory, names[0], "sha256sum.txt"), "utf8"), /^[0-9a-f]{64} /);
  await migrate(db);
  names = await backups(directory);
  assert.equal(names.length, 1);
});

test("shared hook stays shell plus setupdb/sqlite3 and outside server startup", async () => {
  await run("bash", ["-n", script.pathname]);
  await run("/bin/sh", ["-n", script.pathname]);
  const body = await readFile(script, "utf8");
  assert.match(body, /^#!/);
  for (const runtime of ["python", "node ", "ruby", "perl"]) {
    assert.doesNotMatch(body, new RegExp(runtime));
  }
  assert.doesNotMatch(body, /rm .*pending|rm "\$pending"/);
  const startup = await readFile(new URL("../backend/render-free-boot.sh", import.meta.url), "utf8");
  assert.doesNotMatch(startup, /migrate\.sh/);
});

test("Northflank serializes exact builds and gates API startup on the shared script", async () => {
  const workflow = await readJSON("./northflank/release.json");
  assert.equal(workflow.options.concurrencyPolicy, "queue");
  assert.equal(workflow.options.autorun, false);
  assert.equal(workflow.spec.spec.type, "sequential");
  assert.equal(workflow.triggers[0].kind, "webhook");
  assert.equal(workflow.triggers[0].spec.token, "INJECT_PRIVATE_WEBHOOK_TOKEN");
  const steps = workflow.spec.spec.steps;
  assert.deepEqual(steps.map((step) => step.ref), [
    "api-build", "identity-build", "identity-backup", "stop-api-writers",
    "deploy-identity-image", "deploy-maintenance-image", "migrate", "start-api",
  ]);
  for (const step of steps.slice(0, 2)) {
    assert.equal(step.condition, "success");
    assert.equal(step.spec.sha, "${args.RELEASE_SHA}");
    assert.equal(step.spec.buildRuleFallThroughHandling, "fail");
  }
  assert.equal(steps[2].condition, "success");
  assert.equal(steps[2].spec.backupType, "dump");
  for (const index of [3, 7]) {
    assert.equal(steps[index].condition, "success");
    assert.equal(steps[index].spec.templateId, "waypoint-api-command");
  }
  const maintenance = steps[3].spec.arguments.variables[0].value;
  assert.match(maintenance, /httpd -f/);
  assert.match(maintenance, /-h \/tmp\/waypoint-maintenance/);
  assert.doesNotMatch(maintenance, /\/app\/server|\/data/);
  assert.equal(steps[4].spec.origin.build, "${refs.identity-build.id}");
  assert.equal(steps[5].spec.origin.build, "${refs.api-build.id}");
  for (const index of [4, 5]) assert.equal(steps[index].condition, "running");
  const migration = steps[6].spec.spec.data;
  assert.equal(migration.options.dispatchOnly, false);
  assert.equal(migration.user, "10001");
  assert.equal(migration.group, "10001");
  assert.match(migration.command, /test -f.*NET_WORTH_ESTIMATOR_DB.*exec \/app\/migrate\.sh/);
  assert.equal(steps[7].spec.arguments.variables[0].value, "/app/render-free-boot.sh");
});

test("GitHub dispatch sends only a pinned SHA and rejects unsafe or failed webhook calls", async () => {
  const workflow = await readFile(new URL("../.github/workflows/northflank-release.yml", import.meta.url), "utf8");
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /NORTHFLANK_API_TOKEN/);
  const source = workflow.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s*JS/)[1]
    .split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
  const execute = new (Object.getPrototypeOf(async function () {}).constructor)("process", "fetch", "console", source);
  const sha = "a".repeat(40);
  let request;
  const fetch = async (url, options) => { request = { url, options }; return { ok: true }; };
  const process = { env: { RELEASE_SHA: sha, RELEASE_WEBHOOK: "https://webhooks.northflank.com/workflows/private-fixture" } };
  await execute(process, fetch, { log() {} });
  assert.equal(request.url.searchParams.get("RELEASE_SHA"), sha);
  assert.equal(request.options.redirect, "error");
  for (const webhook of ["", "https://attacker.invalid/workflows/private", "https://webhooks.northflank.com/workflows/private?override=1"]) {
    await assert.rejects(execute({ env: { RELEASE_SHA: sha, RELEASE_WEBHOOK: webhook } }, () => assert.fail("Unsafe request"), console));
  }
  await assert.rejects(execute(process, async () => ({ ok: false, status: 409 }), console), /HTTP 409/);
  await assert.rejects(execute({ env: { ...process.env, RELEASE_SHA: "latest" } }, fetch, console), /full release SHA/);
});

test("Northflank command adapter patches only the single API process", async () => {
  const template = await readJSON("./northflank/api-command.json");
  assert.equal(template.options.concurrencyPolicy, "forbid");
  assert.equal(template.options.autorun, false);
  const [patch, wait] = template.spec.spec.steps;
  assert.equal(patch.updateMode, "patch");
  assert.deepEqual(patch.spec, {
    name: "nwe-api",
    deployment: {
      instances: 1,
      docker: { configType: "customCommand", customCommand: "${args.COMMAND}" },
    },
  });
  assert.equal(wait.spec.kind, "Service");
  assert.equal(wait.spec.spec.type, "running");
});

test("API image migrates the full base with checkpoints and Analysis as its user", {
  skip: !process.env.DEPLOYMENT_TEST_IMAGE,
}, async () => {
  const image = process.env.DEPLOYMENT_TEST_IMAGE;
  const { stdout } = await run("docker", ["run", "--rm", "--network", "none", image, "/bin/sh", "-c", `
set -eu
test "$(id -u)" = 10001
test -x /app/migrate.sh
if /app/migrate.sh 2>/dev/null; then exit 1; fi
test ! -e "$NET_WORTH_ESTIMATOR_DB"
export NET_WORTH_ESTIMATOR_DB='/tmp/analysis fixture.db'
/app/setupdb --db "$NET_WORTH_ESTIMATOR_DB" --issuer https://fixture.invalid --subject owner >/dev/null
owner="$(sqlite3 "$NET_WORTH_ESTIMATOR_DB" 'SELECT id FROM users;')"
sqlite3 "$NET_WORTH_ESTIMATOR_DB" "INSERT INTO accounts(user_id, id, position, name, kind, enabled) VALUES ('$owner', 'checking', 0, 'Checking', 'cash', 1);"
sqlite3 "$NET_WORTH_ESTIMATOR_DB" "DROP TRIGGER analysis_posting_lifecycle;
  DROP TABLE analysis_feedback; DROP TABLE analysis_findings; DROP TABLE analysis_runs;
  DROP TABLE transaction_source_facts; DROP TABLE analysis_inputs;
  DELETE FROM schema_migrations WHERE name IN ('transaction-analysis-v1','analysis-feedback-v1');
  DROP TABLE checkpoints;
  CREATE TABLE checkpoints(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id INTEGER NOT NULL, position INTEGER NOT NULL, date TEXT NOT NULL, model_account_id TEXT NOT NULL, balance REAL NOT NULL, source TEXT NOT NULL DEFAULT 'user', PRIMARY KEY(user_id, id), UNIQUE(user_id, model_account_id, date));
  INSERT INTO checkpoints(user_id, id, position, date, model_account_id, balance, source) VALUES ('$owner', 1, 0, '2026-03-10', 'checking', 100, 'user');
  INSERT INTO postings(user_id, id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, enabled, source, pending, void) VALUES ('$owner', 'settled-a', 0, 'Groceries', 'checking', 'null', '{}', 1773140400, 1773129600, 0, 'simplefin', 0, 0), ('$owner', 'manual-a', 1, 'Owner', 'checking', 'null', '{}', 1773140400, 1773129600, 0, 'user', 0, 0);
  INSERT INTO posting_sync_keys(user_id, provider, bridge_account_id, transaction_id, posting_id) VALUES ('$owner', 'simplefin', 'bridge-checking', 'tx1', 'settled-a');"
/app/migrate.sh >/dev/null
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'SELECT observed_at FROM checkpoints;')" = 1773187199
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" "SELECT s.enabled, p.transaction_time FROM postings p JOIN posting_sim s ON s.user_id=p.user_id AND s.posting_id=p.id WHERE p.id = 'settled-a';")" = "1|1773140400"
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" "SELECT s.enabled, p.transaction_time FROM postings p JOIN posting_sim s ON s.user_id=p.user_id AND s.posting_id=p.id WHERE p.id = 'manual-a';")" = "0|1773129600"
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'PRAGMA integrity_check;')" = ok
test -z "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'PRAGMA foreign_key_check;')"
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'SELECT COUNT(*) FROM analysis_feedback;')" = 0
for backup in /tmp/*.analysis-backup.*/before.db; do
  test "$(stat -c %a "$backup")" = 600
  test "$(sqlite3 -readonly "$backup" 'SELECT date FROM checkpoints;')" = 2026-03-10
done
/app/migrate.sh >/dev/null
sqlite3 "$NET_WORTH_ESTIMATOR_DB" "INSERT INTO transaction_source_facts(user_id,posting_id,facts_json) VALUES ('$owner','settled-a','{}');"
/app/migrate.sh >/dev/null
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'SELECT facts_json FROM transaction_source_facts;')" = '{}'
sha256sum /app/migrate.sh
`]);
  const expected = createHash("sha256").update(await readFile(script)).digest("hex");
  assert.equal(stdout.trim().split(/\s+/)[0], expected);
});
