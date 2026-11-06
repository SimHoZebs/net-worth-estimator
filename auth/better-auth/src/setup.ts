import { chmod, open } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "./auth";
import { settings, type Settings } from "./config";
import { openDatabase, closeDatabase, isPostgres, sealIdentity } from "./database";
import { registerClient } from "./provision";

// Explicit provisioning only. Normal server startup never creates or repairs schema.
export async function setup(config: Settings) {
  if (!isPostgres(config.database)) {
    const file = await open(config.database, "wx", 0o600);
    await file.close();
  }
  const db = openDatabase(config.database, true);
  try {
    const auth = createAuth(config, db, true);
    if ("connect" in db) {
      const exists = await db.query("SELECT to_regclass('\"user\"') AS existing");
      if (exists.rows[0].existing)
        throw new Error("Identity schema already exists. Use the explicit import command.");
    }
    await (await getMigrations(auth.options)).runMigrations();
    await registerClient(auth, config);
    await sealIdentity(db, config.issuer, config.clientId);
    if (!isPostgres(config.database)) await chmod(config.database, 0o600);
  } finally {
    await closeDatabase(db);
  }
}

if (import.meta.main) {
  process.umask(0o077);
  await setup(settings());
}
