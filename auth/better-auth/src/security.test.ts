import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup } from "../test-support";
import { createAuth } from "./auth";
import { openDatabase, closeDatabase } from "./database";
import { handler } from "./server";
import { withClientAddress } from "./client-ip";
import type { Settings } from "./config";

const base = {
  issuer: "http://localhost:9800",
  appUrl: "http://localhost:9801",
  secret: "auth-secret-123456789012345678901234",
  clientId: "waypoint",
  clientSecret: "client-secret-123456789012345678901234",
};

test("trusted ingress clients have separate sign-in limits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "waypoint-auth-rate-"));
  const config: Settings = { ...base, database: join(dir, "identity.db") };
  try {
    await setup(config, { username: "owner", password: "test-password", name: "Owner" });
    const db = openDatabase(config.database);
    try {
      const serve = handler(createAuth(config, db), config);
      const attempt = (address: string) =>
        serve(
          withClientAddress(
            new Request(`${config.issuer}/sign-in`, {
              method: "POST",
              headers: {
                origin: config.issuer,
                "x-envoy-external-address": address,
                "x-waypoint-client-ip": "203.0.113.99",
              },
              body: new URLSearchParams({ username: "owner", password: "wrong-password" }),
            }),
            "10.0.0.1",
            "x-envoy-external-address",
          ),
        );
      for (let i = 0; i < 3; i++) expect((await attempt("198.51.100.1")).status).toBe(401);
      expect((await attempt("198.51.100.1")).status).toBe(429);
      expect((await attempt("198.51.100.2")).status).toBe(401);
    } finally {
      await closeDatabase(db);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);

test("Unicode and email-style usernames work in setup and native signup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "waypoint-auth-usernames-"));
  try {
    for (const [index, username] of ["user@example.com", "éclair"].entries()) {
      const config: Settings = { ...base, database: join(dir, `setup-${index}.db`) };
      const bootstrap = await setup(config, {
        username,
        password: "test-password",
        name: username,
      });
      const db = openDatabase(config.database);
      try {
        const result = await createAuth(config, db).api.signInUsername({
          body: { username, password: "test-password" },
        });
        expect(result.user.id).toBe(bootstrap.subject);
      } finally {
        await closeDatabase(db);
      }

      const signupConfig = { ...config, database: join(dir, `signup-${index}.db`) };
      await setup(signupConfig, {
        username: "bootstrap",
        password: "test-password",
        name: "Bootstrap",
      });
      const signupDb = openDatabase(signupConfig.database);
      try {
        const auth = createAuth(signupConfig, signupDb);
        const response = await handler(
          auth,
          signupConfig,
        )(
          new Request(`${config.issuer}/sign-up`, {
            method: "POST",
            headers: { origin: config.issuer },
            body: new URLSearchParams({ username, password: "test-password" }),
          }),
        );
        expect(response.status).toBe(303);
        const signedIn = await auth.api.signInUsername({
          body: { username, password: "test-password" },
        });
        expect(signedIn.user.name).toBe(username);
      } finally {
        await closeDatabase(signupDb);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
