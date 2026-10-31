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
await run("go", ["build", "-o", join(tools, "upgrade-posting-sim-split"), "./scripts/one-time/posting-sim-split"], {
  cwd: join(root, "backend"), env: { ...process.env, CGO_ENABLED: "0" },
});
await run("go", ["build", "-o", join(tools, "upgrade-planned-purchases"), "./scripts/one-time/planned-purchases"], {
  cwd: join(root, "backend"), env: { ...process.env, CGO_ENABLED: "0" },
});
const sql = async (db, query) => (await run("sqlite3", [db, query])).stdout.trim();
const sha256File = async (path) => (await run("sha256sum", [path])).stdout.trim().split(/\s+/)[0];
const migrate = (db, env = {}) => run("/bin/sh", [script], {
  env: { ...process.env, PATH: tools + delimiter + process.env.PATH, NET_WORTH_ESTIMATOR_DB: db, ...env },
});
const backups = async (directory) => (await readdir(directory)).filter((name) => name.includes(".analysis-backup."));
async function sourceDatabase() {
  const directory = await mkdtemp("/tmp/opencode/bnpl-migration-db-");
  owned.add(directory);
  const db = join(directory, "application.db");
  await run(join(tools, "setupdb"), ["--db", db, "--issuer", "https://fixture.invalid", "--subject", "owner"]);
  const owner = await sql(db, "SELECT id FROM users;");
  await sql(db, `DROP TRIGGER IF EXISTS analysis_posting_lifecycle;
    DROP TRIGGER IF EXISTS analysis_posting_sim_lifecycle;
    DROP TABLE analysis_feedback; DROP TABLE analysis_findings; DROP TABLE analysis_runs;
    DROP TABLE transaction_source_facts; DROP TABLE analysis_inputs;
    DELETE FROM schema_migrations WHERE name IN ('transaction-analysis-v1','analysis-feedback-v1');`);
  await sql(db, `INSERT INTO accounts(user_id,id,position,name,kind,enabled) VALUES
    ('${owner}','checking',0,'Fixture checking','cash',1);`);
  return { directory, db, owner };
}
async function seedFinalRows(db, owner) {
  await sql(db, `INSERT INTO checkpoints(user_id,id,position,model_account_id,balance,source,observed_at) VALUES
    ('${owner}',1,0,'checking',100,'user',1773187199);`);
  await sql(db, `INSERT INTO postings(user_id,id,name,source_account_id,destination_account_ids,amount_resolution_json,posted_time,transaction_time,source,pending,void) VALUES
    ('${owner}','settled-a','Groceries','checking','null','{}',1773140400,1773129600,'simplefin',0,0),
    ('${owner}','manual-a','Owner','checking','null','{}',1773140400,1773129600,'user',0,0);`);
  await sql(db, `INSERT INTO posting_sim(user_id,posting_id,position,enabled,execution_order) VALUES
    ('${owner}','settled-a',0,0,1),
    ('${owner}','manual-a',1,0,4);`);
  await sql(db, `INSERT INTO posting_sync_keys(user_id,provider,bridge_account_id,transaction_id,posting_id) VALUES
    ('${owner}','simplefin','bridge-checking','tx1','settled-a');`);
}
const analysisSnapshot = async (db) => sql(db, `SELECT user_id, posting_id, facts_json FROM transaction_source_facts ORDER BY 1, 2;
  SELECT user_id, revision FROM analysis_inputs ORDER BY 1;
  SELECT user_id, id, type, version, input_revision, state, started_at, completed_at, lease_until, problem, input_json FROM analysis_runs ORDER BY 1, 2;
  SELECT user_id, id, analysis_type, posting_id, kind, detection_json, run_id, first_detected_at, last_checked_at, status, dismissed, review_json, feedback_revision FROM analysis_findings ORDER BY 1, 2;
  SELECT user_id, id, request_id, finding_id, run_id, created_at, payload_json FROM analysis_feedback ORDER BY 1, 2;`);

test("Analysis migration completes schema on a verified candidate and repeats without writes", async () => {
  const { directory, db, owner } = await sourceDatabase();
  await seedFinalRows(db, owner);
  const snapshot = `SELECT id, issuer, subject FROM users; SELECT * FROM model_metadata; SELECT * FROM accounts; SELECT * FROM checkpoints; SELECT * FROM postings;`;
  const before = await sql(db, snapshot);
  await migrate(db);
  assert.equal(await sql(db, "PRAGMA integrity_check;"), "ok");
  assert.equal(await sql(db, "PRAGMA foreign_key_check;"), "");
  assert.equal(await sql(db, snapshot), before);
  // Final checkpoints never trigger the legacy bank repair.
  assert.equal(await sql(db, "SELECT s.enabled, p.transaction_time FROM postings p JOIN posting_sim s ON s.user_id=p.user_id AND s.posting_id=p.id WHERE p.id = 'settled-a';"), "0|1773129600");
  assert.equal(await sql(db, "SELECT count(*) FROM analysis_feedback; SELECT count(*) FROM analysis_findings;"), "0\n0");
  const names = await backups(directory);
  assert.equal(names.length, 1);
  const backup = join(directory, names[0], "before.db");
  assert.equal((await stat(backup)).mode & 0o077, 0);
  assert.equal(await sql(backup, "PRAGMA integrity_check;"), "ok");
  assert.equal(await sql(backup, snapshot), before);
  // The candidate was provisioned, so the backup predates Analysis tables.
  assert.equal(await sql(backup, "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name='analysis_runs';"), "0");
  const hashBefore = await sha256File(db);
  await migrate(db);
  assert.deepEqual(await backups(directory), names);
  assert.equal(await sha256File(db), hashBefore);
});

test("Analysis migration leaves the original untouched on setup failure and permits retry", async () => {
  const { directory, db, owner } = await sourceDatabase();
  await seedFinalRows(db, owner);
  const failures = await mkdtemp("/tmp/opencode/bnpl-migration-failure-");
  owned.add(failures);
  const stubFirstPath = failures + delimiter + tools + delimiter + process.env.PATH;
  await writeFile(join(failures, "setupdb"), `#!/bin/sh\ntouch '${join(failures, "ran")}'\nexit 23\n`, { mode: 0o700 });
  const dumpBefore = await sql(db, ".dump");
  await assert.rejects(migrate(db, { PATH: stubFirstPath }), /Candidate setup failed/);
  assert.equal(await readFile(join(failures, "ran"), "utf8"), "");
  const names = await backups(directory);
  assert.equal(names.length, 1);
  assert.equal(await sql(join(directory, names[0], "before.db"), "PRAGMA integrity_check;"), "ok");
  // The failed candidate never published: no Analysis tables, rows intact.
  assert.equal(await sql(db, ".dump"), dumpBefore);
  assert.equal(await sql(db, "SELECT count(*) FROM sqlite_schema WHERE name='analysis_findings';"), "0");
  assert.equal(await sql(db, "SELECT name FROM accounts;"), "Fixture checking");
  assert.ok(!(await readdir(directory)).some((name) => name.endsWith(".analysis-migration-pending")));
  await migrate(db);
  assert.equal(await sql(db, "SELECT count(*) FROM accounts;"), "1");
  assert.equal(await sql(db, "SELECT count(*) FROM schema_migrations WHERE name='analysis-feedback-v1';"), "1");
  assert.equal((await backups(directory)).length, 2);
});

test("failed row preservation leaves the original publishable without a pending file", async () => {
  const { directory, db, owner } = await sourceDatabase();
  await seedFinalRows(db, owner);
  const failures = await mkdtemp("/tmp/opencode/bnpl-migration-corruption-");
  owned.add(failures);
  await writeFile(join(failures, "setupdb"), `#!/bin/sh\n"${join(tools, "setupdb")}" "$@"\n# Corrupt the candidate the hook just provisioned, never the original.\ndb=""; for arg in "$@"; do if [ "$want_db" = 1 ]; then db="$arg"; fi; case "$arg" in --db) want_db=1;; *) want_db=0;; esac; done\nsqlite3 "$db" "UPDATE accounts SET name='Unexpected edit';"\n`, { mode: 0o700 });
  const dumpBefore = await sql(db, ".dump");
  await assert.rejects(
    migrate(db, { PATH: failures + delimiter + tools + delimiter + process.env.PATH }),
    /Candidate setup changed schema or rows/,
  );
  // Stronger than restore-and-retry: the original was never mutated, so no
  // pending file exists and a plain retry provisions the clean candidate.
  assert.equal(await sql(db, ".dump"), dumpBefore);
  assert.equal(await sql(db, "SELECT count(*) FROM sqlite_schema WHERE name='analysis_findings';"), "0");
  assert.ok(!(await readdir(directory)).some((name) => name.endsWith(".analysis-migration-pending")));
  await migrate(db);
  assert.equal(await sql(db, "SELECT name FROM accounts;"), "Fixture checking");
  assert.equal(await sql(db, "SELECT count(*) FROM analysis_findings;"), "0");
});

async function seedRetiredPurchase(db, owner, expression = "125.50") {
  await sql(db, `DROP TABLE planned_purchases;
    CREATE TABLE purchase_policies (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      posting_id TEXT NOT NULL, priority INTEGER NOT NULL CHECK(priority>=0),
      PRIMARY KEY(user_id,posting_id),
      FOREIGN KEY(user_id,posting_id) REFERENCES postings(user_id,id) ON DELETE CASCADE);
    INSERT INTO postings(user_id,id,name,source_account_id,destination_account_ids,amount_resolution_json,posted_time,transaction_time,source,pending,void)
      VALUES ('${owner}','01900000-0000-7000-8000-000000000099','Desk','checking','null','{"resolver":"expression","config":{"expression":"${expression}"},"inputs":{}}',1769904000,1769904000,'user',0,0);
    INSERT INTO posting_sim(user_id,posting_id,position,enabled,execution_order)
      VALUES ('${owner}','01900000-0000-7000-8000-000000000099',2,1,0);
    INSERT INTO entity_ids(user_id,id,kind) VALUES ('${owner}','01900000-0000-7000-8000-000000000099','posting');
    INSERT INTO purchase_policies(user_id,posting_id,priority) VALUES ('${owner}','01900000-0000-7000-8000-000000000099',3);`);
}

test("purchase conversion preserves current observations, bank rows, and Analysis on a verified candidate", async () => {
  const { directory, db, owner } = await sourceDatabase();
  await seedFinalRows(db, owner);
  await migrate(db);
  await seedRetiredPurchase(db, owner);
  const preserved = "SELECT * FROM checkpoints; SELECT * FROM postings WHERE source='simplefin'; SELECT * FROM users;";
  const before = await sql(db, preserved);
  const analysis = await analysisSnapshot(db);
  await migrate(db);
  assert.equal(await sql(db, preserved), before);
  assert.equal(await analysisSnapshot(db), analysis);
  assert.equal(await sql(db, "SELECT name,cost,earliest_date,priority,enabled FROM planned_purchases;"), "Desk|125.5|2026-02-01|3|1");
  assert.equal(await sql(db, "SELECT count(*) FROM sqlite_schema WHERE name='purchase_policies';"), "0");
  assert.equal(await sql(db, "SELECT count(*) FROM postings WHERE id='01900000-0000-7000-8000-000000000099';"), "0");
  assert.equal(await sql(db, "SELECT kind FROM entity_ids WHERE id='01900000-0000-7000-8000-000000000099';"), "planned-purchase");
  const hash = await sha256File(db);
  await migrate(db);
  assert.equal(await sha256File(db), hash);
  assert.equal((await backups(directory)).length, 2);
});

test("unsafe purchase conversion leaves original bytes and schema unchanged", async () => {
  const { directory, db, owner } = await sourceDatabase();
  await seedRetiredPurchase(db, owner, "variable * 2");
  const before = await sha256File(db);
  await assert.rejects(migrate(db), /Candidate purchase conversion failed/);
  assert.equal(await sha256File(db), before);
  assert.equal(await sql(db, "SELECT count(*) FROM sqlite_schema WHERE name='planned_purchases';"), "0");
  assert.equal(await sql(db, "SELECT count(*) FROM purchase_policies;"), "1");
  assert.equal((await backups(directory)).length, 1);
});

test("an old pending file still rejects an unverified complete target", async () => {
  const { db, owner } = await sourceDatabase();
  await seedFinalRows(db, owner);
  await migrate(db);
  const hashBefore = await sha256File(db);
  await writeFile(db + ".analysis-migration-pending", "/tmp/opencode/stale-backup/before.db\n");
  await assert.rejects(migrate(db), /Unverified prior Analysis migration/);
  assert.equal(await sha256File(db), hashBefore);
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

test("target image converts retired purchases before the API can start", {
  skip: !process.env.DEPLOYMENT_TEST_IMAGE,
}, async () => {
  await run("docker", ["run", "--rm", "--network", "none", process.env.DEPLOYMENT_TEST_IMAGE, "/bin/sh", "-c", `
set -eu
test "$(id -u)" = 10001
test -x /app/upgrade-planned-purchases
export NET_WORTH_ESTIMATOR_DB=/tmp/purchases.db
/app/setupdb --db "$NET_WORTH_ESTIMATOR_DB" --issuer https://fixture.invalid --subject owner >/dev/null
sqlite3 "$NET_WORTH_ESTIMATOR_DB" <<'SQL'
DROP TABLE planned_purchases;
CREATE TABLE purchase_policies(user_id TEXT NOT NULL REFERENCES users(id),posting_id TEXT NOT NULL,priority INTEGER NOT NULL,PRIMARY KEY(user_id,posting_id),FOREIGN KEY(user_id,posting_id) REFERENCES postings(user_id,id) ON DELETE CASCADE);
INSERT INTO accounts(user_id,id,position,name,kind,enabled) SELECT id,'cash',0,'Cash','cash',1 FROM users;
INSERT INTO postings(user_id,id,name,source_account_id,destination_account_ids,amount_resolution_json,posted_time,transaction_time,source,pending,void)
 SELECT id,'01900000-0000-7000-8000-000000000099','Desk','cash','null','{"resolver":"expression","config":{"expression":"125.50"},"inputs":{}}',1769904000,1769904000,'user',0,0 FROM users;
INSERT INTO posting_sim(user_id,posting_id,position,enabled,execution_order)
 SELECT id,'01900000-0000-7000-8000-000000000099',0,1,0 FROM users;
INSERT INTO entity_ids(user_id,id,kind) SELECT id,'01900000-0000-7000-8000-000000000099','posting' FROM users;
INSERT INTO purchase_policies(user_id,posting_id,priority) SELECT id,'01900000-0000-7000-8000-000000000099',3 FROM users;
SQL
/app/migrate.sh >/dev/null
test "$(sqlite3 "$NET_WORTH_ESTIMATOR_DB" 'SELECT name,cost,priority FROM planned_purchases;')" = 'Desk|125.5|3'
test "$(sqlite3 "$NET_WORTH_ESTIMATOR_DB" 'SELECT count(*) FROM postings;')" = 0
/app/setupdb --db "$NET_WORTH_ESTIMATOR_DB" >/dev/null
/app/migrate.sh >/dev/null
test "$(sqlite3 "$NET_WORTH_ESTIMATOR_DB" 'PRAGMA integrity_check;')" = ok
test -z "$(sqlite3 "$NET_WORTH_ESTIMATOR_DB" 'PRAGMA foreign_key_check;')"
`]);
});

test("target image provisions Analysis, preserves facts, and survives setup failure", {
  skip: !process.env.DEPLOYMENT_TEST_IMAGE,
}, async () => {
  await run("docker", ["run", "--rm", "--network", "none", process.env.DEPLOYMENT_TEST_IMAGE, "/bin/sh", "-c", `
set -eu
test "$(id -u)" = 10001
test -x /app/migrate.sh
export NET_WORTH_ESTIMATOR_DB='/tmp/analysis fixture.db'
if /app/migrate.sh 2>/dev/null; then exit 1; fi
/app/setupdb --db "$NET_WORTH_ESTIMATOR_DB" --issuer https://fixture.invalid --subject owner >/dev/null
owner="$(sqlite3 "$NET_WORTH_ESTIMATOR_DB" 'SELECT id FROM users;')"
sqlite3 "$NET_WORTH_ESTIMATOR_DB" "INSERT INTO accounts(user_id,id,position,name,kind,enabled) VALUES ('$owner','checking',0,'Fixture checking','cash',1);
  INSERT INTO checkpoints(user_id,id,position,model_account_id,balance,source,observed_at) VALUES ('$owner',1,0,'checking',100,'user',1773187199);
  INSERT INTO postings(user_id,id,name,source_account_id,destination_account_ids,amount_resolution_json,posted_time,transaction_time,source,pending,void) VALUES ('$owner','settled-a','Groceries','checking','null','{}',1773140400,1773140400,'simplefin',0,0);
  INSERT INTO posting_sim(user_id,posting_id,position,enabled,execution_order) VALUES ('$owner','settled-a',0,1,1);"
sqlite3 "$NET_WORTH_ESTIMATOR_DB" "DROP TRIGGER IF EXISTS analysis_posting_lifecycle;
  DROP TRIGGER IF EXISTS analysis_posting_sim_lifecycle;
  DROP TABLE analysis_feedback; DROP TABLE analysis_findings; DROP TABLE analysis_runs;
  DROP TABLE transaction_source_facts; DROP TABLE analysis_inputs;
  DELETE FROM schema_migrations WHERE name IN ('transaction-analysis-v1','analysis-feedback-v1');"
/app/migrate.sh >/dev/null
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'SELECT observed_at FROM checkpoints;')" = 1773187199
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'SELECT COUNT(*) FROM analysis_feedback;')" = 0
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'PRAGMA integrity_check;')" = ok
test -z "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'PRAGMA foreign_key_check;')"
test 1 -eq "$(find /tmp -maxdepth 1 -name '*.analysis-backup.*' | wc -l)"
for backup in /tmp/*.analysis-backup.*/before.db; do
  test "$(stat -c %a "$backup")" = 600
done
sqlite3 "$NET_WORTH_ESTIMATOR_DB" "INSERT INTO transaction_source_facts(user_id,posting_id,facts_json) VALUES ('$owner','settled-a','{}');
  INSERT INTO analysis_runs(user_id,id,type,version,input_revision,state,started_at,completed_at,lease_until,problem,input_json) VALUES ('$owner','run-1','bnpl','v1',1,'complete',100,200,0,'','{}');
  INSERT INTO analysis_findings(user_id,id,analysis_type,posting_id,kind,detection_json,run_id,first_detected_at,last_checked_at,status,dismissed,review_json,feedback_revision) VALUES ('$owner','f-1','bnpl','settled-a','bnpl','{}','run-1',100,150,'active',0,'null',0);
  INSERT INTO analysis_feedback(user_id,id,request_id,finding_id,run_id,created_at,payload_json) VALUES ('$owner','fb-1','req-1','f-1','run-1',160,'{}');"
revision="$(sqlite3 "$NET_WORTH_ESTIMATOR_DB" "SELECT revision FROM analysis_inputs WHERE user_id = '$owner';")"
/app/migrate.sh >/dev/null
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" "SELECT facts_json FROM transaction_source_facts WHERE posting_id = 'settled-a';")" = '{}'
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" "SELECT payload_json FROM analysis_feedback WHERE id = 'fb-1';")" = '{}'
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" "SELECT revision FROM analysis_inputs WHERE user_id = '$owner';")" = "$revision"
test "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'PRAGMA integrity_check;')" = ok
test -z "$(sqlite3 -readonly "$NET_WORTH_ESTIMATOR_DB" 'PRAGMA foreign_key_check;')"
sha_before="$(sha256sum "$NET_WORTH_ESTIMATOR_DB")"
/app/migrate.sh >/dev/null
test "$(sha256sum "$NET_WORTH_ESTIMATOR_DB")" = "$sha_before"
export SECOND_DB='/tmp/analysis second.db'
/app/setupdb --db "$SECOND_DB" --issuer https://fixture.invalid --subject owner >/dev/null
owner2="$(sqlite3 "$SECOND_DB" 'SELECT id FROM users;')"
sqlite3 "$SECOND_DB" "DROP TRIGGER analysis_posting_lifecycle;
  DROP TABLE analysis_feedback; DROP TABLE analysis_findings; DROP TABLE analysis_runs;
  DROP TABLE transaction_source_facts; DROP TABLE analysis_inputs;
  DELETE FROM schema_migrations WHERE name IN ('transaction-analysis-v1','analysis-feedback-v1');
  INSERT INTO accounts(user_id,id,position,name,kind,enabled) VALUES ('$owner2','checking',0,'Second','cash',1);
  INSERT INTO checkpoints(user_id,id,position,model_account_id,balance,source,observed_at) VALUES ('$owner2',1,0,'checking',50,'user',1773187199);"
mkdir -p /tmp/failbin
printf '#!/bin/sh\\nexit 23\\n' > /tmp/failbin/setupdb
chmod 700 /tmp/failbin/setupdb
if PATH="/tmp/failbin:$PATH" NET_WORTH_ESTIMATOR_DB="$SECOND_DB" /app/migrate.sh >/dev/null 2>&1; then exit 1; fi
test "$(sqlite3 -readonly "$SECOND_DB" "SELECT count(*) FROM sqlite_schema WHERE name='analysis_findings';")" = 0
test "$(sqlite3 -readonly "$SECOND_DB" 'PRAGMA integrity_check;')" = ok
NET_WORTH_ESTIMATOR_DB="$SECOND_DB" /app/migrate.sh >/dev/null
test "$(sqlite3 -readonly "$SECOND_DB" "SELECT observed_at FROM checkpoints;")" = 1773187199
test 3 -eq "$(find /tmp -maxdepth 1 -name '*.analysis-backup.*' | wc -l)"
`]);
});
