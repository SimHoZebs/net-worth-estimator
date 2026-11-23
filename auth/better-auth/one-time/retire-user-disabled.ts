// One-time, offline retirement of the Better Auth "user"."disabled" column.
// Never imported by the runtime, the server, or normal setup.
//
// The shipped auth code stopped writing and reading the flag, but an existing
// database still carries it as NOT NULL with no default. Better Auth validates
// the database schema on every API call, so that leftover column fails
// discovery and every other endpoint with a 503 until it is removed.
//
// Run with every identity writer stopped, against the real durable identity
// database, from the reviewed target image. Take a verified backup first:
// PostgreSQL operators use a Northflank addon dump (the release workflow's
// identity-backup step does this), SQLite operators get a verified copy from
// this script.
import { copyFile, chmod, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { Client } from "pg";

const table = '"user"';
const column = "disabled";
const retained = ["id", "name", "email", "username"];

export interface Plan {
  database: "postgres" | "sqlite";
  present: boolean;
  rowCount: number;
  backup?: string;
}

function sqlite(path: string, readonly = false) {
  return new Database(path, { readonly, strict: true });
}

function sqliteColumns(db: Database, name: string) {
  return db
    .query(`PRAGMA table_info(${JSON.stringify(name)})`)
    .all()
    .map((row) => (row as { name: string }).name);
}

function quotePath(path: string) {
  return `'${path.replaceAll("'", "''")}'`;
}

async function inspectSqlite(path: string): Promise<Plan> {
  for (const suffix of ["-wal", "-shm", "-journal"])
    if (existsSync(path + suffix))
      throw new Error(
        `identity database is not quiescent (${suffix} exists); stop the service first`,
      );
  const db = sqlite(path, true);
  try {
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('user','waypoint_identity_config')",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    if (!tables.includes("user") || !tables.includes("waypoint_identity_config"))
      throw new Error("identity database is missing its current tables");
    const columns = sqliteColumns(db, "user");
    if (columns.includes("disabled")) {
      const missing = retained.filter((name) => !columns.includes(name));
      if (missing.length)
        throw new Error(`user is missing retained columns: ${missing.join(", ")}`);
    }
    const rowCount = (db.query('SELECT COUNT(*) AS n FROM "user"').get() as { n: number }).n;
    return { database: "sqlite", present: columns.includes("disabled"), rowCount };
  } finally {
    db.close();
  }
}

async function inspectPostgres(client: Client): Promise<Plan> {
  const tables = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('user','waypoint_identity_config')",
  );
  if (tables.rowCount !== 2) throw new Error("identity database is missing its current tables");
  const columns = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'user'",
  );
  const names = columns.rows.map((row) => row.column_name as string);
  if (names.includes(column)) {
    const missing = retained.filter((name) => !names.includes(name));
    if (missing.length) throw new Error(`user is missing retained columns: ${missing.join(", ")}`);
  }
  const rows = await client.query('SELECT COUNT(*)::int AS n FROM "user"');
  return { database: "postgres", present: names.includes(column), rowCount: rows.rows[0].n };
}

function digestSqlite(db: Database) {
  return db
    .query(
      "SELECT COUNT(*) || ':' || COALESCE(SUM(LENGTH(id)+LENGTH(name)+LENGTH(email)+COALESCE(LENGTH(username),0)),0) AS d FROM \"user\"",
    )
    .get() as { d: string };
}

async function digestPostgres(client: Client) {
  const result = await client.query(
    "SELECT COUNT(*)::text || ':' || COALESCE(SUM(LENGTH(id)+LENGTH(name)+LENGTH(email)+COALESCE(LENGTH(username),0)),0)::text AS d FROM \"user\"",
  );
  return result.rows[0].d as string;
}

function assertSqliteCandidate(path: string, before: Plan, beforeDigest: string) {
  const db = sqlite(path, true);
  try {
    if (sqliteColumns(db, "user").includes(column))
      throw new Error("disabled survived on candidate");
    const after = db.query('SELECT COUNT(*) AS n FROM "user"').get() as { n: number };
    if (after.n !== before.rowCount) throw new Error("user row count changed on candidate");
    if (digestSqlite(db).d !== beforeDigest)
      throw new Error("retained user rows changed on candidate");
    const integrity = db.query("PRAGMA integrity_check").get() as { integrity_check: string };
    if (integrity.integrity_check !== "ok")
      throw new Error(`candidate integrity check: ${integrity.integrity_check}`);
    const violations = db.query("PRAGMA foreign_key_check").all();
    if (violations.length) throw new Error("candidate has foreign key violations");
  } finally {
    db.close();
  }
}

export async function retireUserDisabled(
  database: string,
  options: { apply: boolean; backup?: string },
): Promise<Plan> {
  if (/^postgres(?:ql)?:\/\//.test(database)) {
    if (options.apply && !options.backup)
      throw new Error("PostgreSQL retirement requires --backup naming the verified addon dump");
    const client = new Client({ connectionString: database });
    await client.connect();
    try {
      const plan = await inspectPostgres(client);
      if (!plan.present) return { ...plan, backup: options.backup };
      if (!options.apply) return { ...plan, backup: options.backup };
      const beforeDigest = await digestPostgres(client);
      await client.query("BEGIN");
      try {
        await client.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
        const columns = await client.query(
          "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'user' AND column_name = $1",
          [column],
        );
        if (columns.rows[0].n !== 0) throw new Error("disabled survived the drop");
        if ((await digestPostgres(client)) !== beforeDigest)
          throw new Error("retained user rows changed during the drop");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      return { ...plan, backup: options.backup };
    } finally {
      await client.end();
    }
  }

  const plan = await inspectSqlite(database);
  if (!plan.present || !options.apply) return plan;
  const backup = `${database}.retire-user-disabled-${Date.now()}.db`;
  const candidate = `${backup}.candidate`;
  try {
    const source = sqlite(database);
    try {
      source.exec(`VACUUM INTO ${quotePath(backup)}`);
    } finally {
      source.close();
    }
    await chmod(backup, 0o600);
    await copyFile(backup, candidate);
    const before = sqlite(backup, true);
    let beforeDigest: string;
    try {
      beforeDigest = digestSqlite(before).d;
    } finally {
      before.close();
    }
    const editing = sqlite(candidate);
    try {
      editing.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    } finally {
      editing.close();
    }
    assertSqliteCandidate(candidate, plan, beforeDigest);
    await rename(candidate, database);
    return { ...plan, backup };
  } catch (error) {
    await rm(candidate, { force: true });
    throw error;
  }
}

if (import.meta.main) {
  const apply = process.argv.includes("--apply");
  const backupIndex = process.argv.indexOf("--backup");
  const backup = backupIndex === -1 ? undefined : process.argv[backupIndex + 1];
  if (backupIndex !== -1 && !backup) throw new Error("--backup requires a value");
  const database = process.env.AUTH_DATABASE;
  if (!database) throw new Error("AUTH_DATABASE is required");
  const plan = await retireUserDisabled(database, { apply, backup });
  console.log(
    JSON.stringify(
      {
        database: plan.database,
        disabled_present: plan.present,
        user_rows: plan.rowCount,
        applied: apply && plan.present,
        backup: plan.backup ?? null,
      },
      null,
      2,
    ),
  );
  if (!apply && plan.present) console.log("dry run; pass --apply to retire the column");
}
