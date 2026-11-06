import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importCasdoor, validateManifest } from "./import-casdoor";
import { createAuth } from "../src/auth";
import { openDatabase, closeDatabase } from "../src/database";

test("one-time import preserves subjects, password verification and existing target bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "waypoint-auth-import-"));
  const config = {
    issuer: "http://localhost:9900",
    appUrl: "http://localhost:9901",
    database: join(dir, "identity.db"),
    secret: "auth-secret-123456789012345678901234",
    clientId: "waypoint",
    clientSecret: "client-secret-123456789012345678901234",
    backchannelUrl: undefined,
  };
  const manifest = {
    issuer: config.issuer,
    guestSubject: "original-guest",
    users: [
      {
        subject: "original-owner",
        username: "old-owner",
        displayName: "Owner",
        bcryptHash: await Bun.password.hash("original-password", { algorithm: "bcrypt", cost: 12 }),
        disabled: false,
        permissions: ["user:read", "user:project", "user:write"],
      },
      {
        subject: "original-guest",
        username: "guest",
        displayName: "Guest",
        disabled: true,
        permissions: ["user:read", "user:project"],
      },
    ],
  };
  try {
    expect(() =>
      validateManifest({ ...manifest, issuer: "https://different.test" }, config.issuer),
    ).toThrow();
    expect(() =>
      validateManifest(
        { ...manifest, users: [...manifest.users, manifest.users[0]] },
        config.issuer,
      ),
    ).toThrow();
    const result = await importCasdoor(config, manifest);
    expect(result.subject).toBe("original-owner");
    expect(result.guest_subject).toBe("original-guest");
    const db = openDatabase(config.database);
    try {
      const auth = createAuth(config, db);
      const signedIn = await auth.api.signInUsername({
        body: { username: "old-owner", password: "original-password" },
      });
      expect(signedIn.user.id).toBe("original-owner");
    } finally {
      await closeDatabase(db);
    }
    const before = await readFile(config.database);
    await expect(importCasdoor(config, manifest)).rejects.toThrow();
    expect(await readFile(config.database)).toEqual(before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
