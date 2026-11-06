import { chmod, open } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "./auth";
import { settings, type Settings } from "./config";
import { openDatabase, closeDatabase, isPostgres, sealIdentity } from "./database";
import { registerClient } from "./provision";

// Explicit provisioning only. Normal server startup never creates or repairs schema.
export async function setup(
  config: Settings,
  owner: { username: string; password: string; name: string },
) {
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
    const ctx = await auth.$context;
    const result = await auth.api.signUpEmail({
      body: {
        email: `${crypto.randomUUID()}@users.invalid`,
        username: owner.username,
        password: owner.password,
        name: owner.name,
      },
    });
    const guest = await ctx.internalAdapter.createUser(
      {
        id: crypto.randomUUID(),
        name: "Guest",
        email: `${crypto.randomUUID()}@users.invalid`,
        emailVerified: false,
        disabled: true,
      },
      { method: "admin" },
    );
    // Server-only API requires an authenticated session. No network admin route exists.
    const client = await registerClient(auth, config, result.token!);
    // Provisioned guest is disabled for interactive login, not permission checks.
    await ctx.internalAdapter.deleteUserSessions(result.user.id);
    await sealIdentity(db, config.issuer, config.clientId);
    if (!isPostgres(config.database)) await chmod(config.database, 0o600);
    return {
      issuer: config.issuer,
      client_id: client.client_id,
      subject: result.user.id,
      guest_subject: guest.id,
      username: owner.username,
    };
  } finally {
    await closeDatabase(db);
  }
}

if (import.meta.main) {
  process.umask(0o077);
  const config = settings();
  const output =
    process.env.AUTH_BOOTSTRAP_FILE ||
    (!isPostgres(config.database) ? `${config.database}.bootstrap.json` : "");
  if (!output) throw new Error("AUTH_BOOTSTRAP_FILE is required for PostgreSQL setup");
  const username = process.env.AUTH_USER_NAME;
  const password = process.env.AUTH_USER_PASSWORD;
  if (!username || !password) throw new Error("AUTH_USER_NAME and AUTH_USER_PASSWORD are required");
  const bootstrap = await setup(config, {
    username,
    password,
    name: process.env.AUTH_USER_DISPLAY_NAME || username,
  });
  await Bun.write(output, JSON.stringify(bootstrap, null, 2), { mode: 0o600 });
}
