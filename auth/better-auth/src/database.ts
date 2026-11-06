import { Database } from "bun:sqlite";
import { Pool } from "pg";

export type IdentityDatabase = Database | Pool;
export const isPostgres = (path: string) => /^postgres(?:ql)?:\/\//.test(path);

export function openDatabase(path: string, create = false): IdentityDatabase {
  if (isPostgres(path))
    return new Pool({ connectionString: path, max: 5, connectionTimeoutMillis: 5000 });
  const db = new Database(path, { create, strict: true });
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return db;
}

export async function closeDatabase(db: IdentityDatabase) {
  if (db instanceof Database) db.close();
  else await db.end();
}

// An explicit provision/import seals identity ownership only after success.
// Runtime validates this record without creating or repairing any table.
export async function sealIdentity(db: IdentityDatabase, issuer: string, clientId: string) {
  const schema =
    "CREATE TABLE waypoint_identity_config (id INTEGER PRIMARY KEY CHECK (id = 1), issuer TEXT NOT NULL, client_id TEXT NOT NULL)";
  if (db instanceof Database) {
    db.transaction(() => {
      db.exec(schema);
      db.query("INSERT INTO waypoint_identity_config VALUES (1, ?, ?)").run(issuer, clientId);
    })();
  } else {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(schema);
      await client.query("INSERT INTO waypoint_identity_config VALUES (1, $1, $2)", [
        issuer,
        clientId,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function verifyIdentity(db: IdentityDatabase, issuer: string, clientId: string) {
  const query = "SELECT issuer, client_id FROM waypoint_identity_config WHERE id = 1";
  const row =
    db instanceof Database
      ? (db.query(query).get() as { issuer: string; client_id: string } | null)
      : (await db.query(query)).rows[0];
  if (!row || row.issuer !== issuer || row.client_id !== clientId)
    throw new Error("Identity database does not match the configured issuer and client");
}

export async function disabledUser(db: IdentityDatabase, userId: string) {
  const row =
    db instanceof Database
      ? (db.query("SELECT disabled FROM user WHERE id = ?").get(userId) as {
          disabled: boolean | number;
        } | null)
      : (await db.query('SELECT disabled FROM "user" WHERE id = $1', [userId])).rows[0];
  return !row || !!row.disabled;
}

export async function revokeSessionTokens(db: IdentityDatabase, sessionId: string) {
  if (db instanceof Database) {
    db.transaction(() => {
      for (const table of ["oauthAccessToken", "oauthRefreshToken"]) {
        db.query(`UPDATE "${table}" SET revoked = ? WHERE sessionId = ?`).run(
          Date.now(),
          sessionId,
        );
      }
    })();
  } else {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const table of ["oauthAccessToken", "oauthRefreshToken"]) {
        await client.query(`UPDATE "${table}" SET revoked = $1 WHERE "sessionId" = $2`, [
          new Date(),
          sessionId,
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
