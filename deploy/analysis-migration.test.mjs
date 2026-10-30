import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";

const run = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const script = new URL("./migrate.sh", import.meta.url).pathname;
const tools = await mkdtemp("/tmp/opencode/bnpl-migration-tools-");
const owned = new Set([tools]);
after(async () => { for (const directory of owned) await rm(directory, { recursive: true, force: true }); });
await run("go", ["build", "-o", join(tools, "setupdb"), "./cmd/setupdb"], {
  cwd: join(root, "backend"), env: { ...process.env, CGO_ENABLED: "0" },
});
const sql = async (db, query) => (await run("sqlite3", [db, query])).stdout.trim();
const migrate = (db, env = {}) => run("/bin/sh", [script], {
  env: { ...process.env, PATH: tools + delimiter + process.env.PATH, NET_WORTH_ESTIMATOR_DB: db, ...env },
});
async function sourceDatabase() {
  const directory = await mkdtemp("/tmp/opencode/bnpl-migration-db-");
  owned.add(directory);
  const db = join(directory, "application.db");
  await run(join(tools, "setupdb"), ["--db", db, "--issuer", "https://fixture.invalid", "--subject", "owner"]);
  await sql(db, `DROP TRIGGER analysis_posting_lifecycle;
    DROP TABLE analysis_feedback; DROP TABLE analysis_findings; DROP TABLE analysis_runs;
    DROP TABLE transaction_source_facts; DROP TABLE analysis_inputs;
    DELETE FROM schema_migrations WHERE name IN ('transaction-analysis-v1','analysis-feedback-v1');`);
  await sql(db, "INSERT INTO accounts(user_id,id,position,name,kind,enabled) SELECT id,'checking',0,'Fixture checking','cash',1 FROM users;");
  return { directory, db };
}

test("Analysis migration backs up current data, provisions schema, and repeats without writes", async () => {
  const { directory, db } = await sourceDatabase();
  const snapshot = "SELECT id, issuer, subject FROM users; SELECT * FROM model_metadata; SELECT * FROM accounts;";
  const before = await sql(db, snapshot);
  await migrate(db);
  assert.equal(await sql(db, "PRAGMA integrity_check;"), "ok");
  assert.equal(await sql(db, "PRAGMA foreign_key_check;"), "");
  assert.equal(await sql(db, snapshot), before);
  assert.equal(await sql(db, "SELECT count(*) FROM analysis_feedback; SELECT count(*) FROM analysis_findings;"), "0\n0");
  const backups = (await readdir(directory)).filter((name) => name.includes(".analysis-backup."));
  assert.equal(backups.length, 1);
  const backup = join(directory, backups[0], "before.db");
  assert.equal((await stat(backup)).mode & 0o077, 0);
  assert.equal(await sql(backup, "PRAGMA integrity_check;"), "ok");
  assert.equal(await sql(backup, snapshot), before);
  await migrate(db);
  assert.deepEqual((await readdir(directory)).filter((name) => name.includes(".analysis-backup.")), backups);
});

test("Analysis migration retains a verified backup after setup failure and permits retry", async () => {
  const { directory, db } = await sourceDatabase();
  const failures = await mkdtemp("/tmp/opencode/bnpl-migration-failure-");
  owned.add(failures);
  await writeFile(join(failures, "setupdb"), "#!/bin/sh\nexit 23\n", { mode: 0o700 });
  await assert.rejects(migrate(db, { PATH: failures + delimiter + process.env.PATH }), (error) => error.code === 23);
  const backups = (await readdir(directory)).filter((name) => name.includes(".analysis-backup."));
  assert.equal(backups.length, 1);
  assert.equal(await sql(join(directory, backups[0], "before.db"), "PRAGMA integrity_check;"), "ok");
  assert.equal(await sql(db, "SELECT count(*) FROM sqlite_schema WHERE name='analysis_findings';"), "0");
  await migrate(db);
  assert.equal(await sql(db, "SELECT count(*) FROM accounts;"), "1");
  assert.equal((await readdir(directory)).filter((name) => name.includes(".analysis-backup.")).length, 2);
});

test("failed row preservation cannot become a successful repeat", async () => {
  const { db } = await sourceDatabase();
  const failures = await mkdtemp("/tmp/opencode/bnpl-migration-corruption-");
  owned.add(failures);
  await writeFile(join(failures, "setupdb"), `#!/bin/sh\n"${join(tools, "setupdb")}" "$@"\nsqlite3 "$NET_WORTH_ESTIMATOR_DB" "UPDATE accounts SET name='Unexpected edit';"\n`, { mode: 0o700 });
  await assert.rejects(migrate(db, { PATH: failures + delimiter + process.env.PATH }), /changed existing application rows/);
  await assert.rejects(migrate(db), /Unverified prior Analysis migration/);
  const backup = (await readFile(db + ".analysis-migration-pending", "utf8")).trim();
  assert.equal(await sql(backup, "SELECT name FROM accounts;"), "Fixture checking");
  // A stopped-API operator can restore the verified pre-write backup and retry.
  await sql(db, `.restore '${backup}'`);
  await migrate(db);
  assert.equal(await sql(db, "SELECT name FROM accounts;"), "Fixture checking");
});

test("Analysis migration rejects missing, foreign, partial, and incomplete states", async () => {
  const { db } = await sourceDatabase();
  await assert.rejects(migrate(db + ".missing"), /existing application database/);
  await sql(db, "DELETE FROM schema_migrations WHERE name='shared-accounts-v1';");
  await assert.rejects(migrate(db), /Unsupported application schema/);
  await sql(db, "INSERT INTO schema_migrations(name) VALUES ('shared-accounts-v1'); CREATE TABLE analysis_inputs(user_id TEXT PRIMARY KEY, revision INTEGER);");
  await assert.rejects(migrate(db), /Partial Analysis schema/);
  const target = await sourceDatabase();
  await migrate(target.db);
  await sql(target.db, "ALTER TABLE analysis_findings DROP COLUMN feedback_revision;");
  await assert.rejects(migrate(target.db), /Incomplete Analysis schema/);
  const partialBase = await sourceDatabase();
  await sql(partialBase.db, "DROP TABLE accounts;");
  await assert.rejects(migrate(partialBase.db), /Incomplete application schema/);
});

test("target image migrates real SQLite as its non-root application user", {
  skip: !process.env.DEPLOYMENT_TEST_IMAGE,
}, async () => {
  await run("docker", ["run", "--rm", "--network", "none", process.env.DEPLOYMENT_TEST_IMAGE, "/bin/sh", "-c", `
set -eu
test "$(id -u)" = 10001
export NET_WORTH_ESTIMATOR_DB='/tmp/analysis fixture.db'
/app/setupdb --db "$NET_WORTH_ESTIMATOR_DB" --issuer https://fixture.invalid --subject owner
sqlite3 "$NET_WORTH_ESTIMATOR_DB" "
  DROP TRIGGER analysis_posting_lifecycle;
  DROP TABLE analysis_feedback; DROP TABLE analysis_findings; DROP TABLE analysis_runs;
  DROP TABLE transaction_source_facts; DROP TABLE analysis_inputs;
  DELETE FROM schema_migrations WHERE name IN ('transaction-analysis-v1','analysis-feedback-v1');
  INSERT INTO accounts(user_id,id,position,name,kind,enabled) SELECT id,'checking',0,'Fixture checking','cash',1 FROM users;"
/app/migrate.sh
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'SELECT name FROM accounts;')" = 'Fixture checking'
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'PRAGMA integrity_check;')" = ok
test -z "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'PRAGMA foreign_key_check;')"
for backup in /tmp/*.analysis-backup.*/before.db; do
  test "$(stat -c %a "$backup")" = 600
  test "$(sqlite3 -readonly "$backup" 'SELECT name FROM accounts;')" = 'Fixture checking'
done
/app/migrate.sh
`]);
});
