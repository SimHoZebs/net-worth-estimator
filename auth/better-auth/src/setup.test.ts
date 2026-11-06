import { expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup } from "./setup";
import { createAuth } from "./auth";
import { openDatabase, closeDatabase, verifyIdentity } from "./database";
import { handler } from "./server";

test("identity infrastructure initializes without creating users or sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-schema-"));
  const config = {
    issuer: "http://localhost:9800",
    appUrl: "http://localhost:9801",
    database: join(directory, "identity.db"),
    secret: "auth-secret-123456789012345678901234",
    clientId: "waypoint",
    clientSecret: "client-secret-123456789012345678901234",
  };
  try {
    await setup(config);
    const db = openDatabase(config.database);
    try {
      await verifyIdentity(db, config.issuer, config.clientId);
      const auth = createAuth(config, db),
        ctx = await auth.$context;
      for (const model of ["user", "account", "session"])
        expect(await ctx.adapter.count({ model })).toBe(0);
      const client = await ctx.adapter.findOne<{ userId?: string; clientSecret: string }>({
        model: "oauthClient",
        where: [{ field: "clientId", value: config.clientId }],
      });
      expect(client).toBeTruthy();
      expect(client?.userId ?? null).toBeNull();
      expect(client?.clientSecret).not.toBe(config.clientSecret);
      const serve = handler(auth, config);
      const signup = await serve(
        new Request(`${config.issuer}/sign-up`, {
          method: "POST",
          headers: { origin: config.issuer },
          body: new URLSearchParams({ username: "ordinary-user", password: "ordinary-password" }),
        }),
      );
      expect(signup.status).toBe(303);
      expect(await ctx.adapter.count({ model: "user" })).toBe(1);
      const signedIn = await auth.api.signInUsername({
        body: { username: "ordinary-user", password: "ordinary-password" },
      });
      expect(signedIn.user.username).toBe("ordinary-user");
      expect(signedIn.user.name).toBe("ordinary-user");
    } finally {
      await closeDatabase(db);
    }
    const before = await readFile(config.database);
    await expect(setup(config)).rejects.toThrow();
    expect(await readFile(config.database)).toEqual(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
