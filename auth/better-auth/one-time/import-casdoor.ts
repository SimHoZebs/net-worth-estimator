// One-time, offline import. Never imported by runtime or normal setup.
import { open, readFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../src/auth";
import { settings, type Settings } from "../src/config";
import { openDatabase, closeDatabase, isPostgres, sealIdentity } from "../src/database";
import { registerClient } from "../src/provision";

export interface ImportUser {
  subject: string;
  username: string;
  displayName: string;
  bcryptHash?: string;
  disabled: boolean;
  permissions: string[];
}
export interface Manifest {
  issuer: string;
  guestSubject: string;
  users: ImportUser[];
}

export function validateManifest(input: unknown, issuer: string): Manifest {
  const manifest = input as Manifest;
  if (
    !manifest ||
    manifest.issuer !== issuer ||
    !Array.isArray(manifest.users) ||
    !manifest.users.length
  )
    throw new Error("Import requires a reviewed manifest and the exact original issuer");
  const subjects = new Set<string>(),
    names = new Set<string>();
  for (const user of manifest.users) {
    if (
      !user ||
      typeof user.subject !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(user.subject) ||
      typeof user.username !== "string" ||
      !/^[\p{L}\p{N}_.@-]{1,64}$/u.test(user.username) ||
      typeof user.displayName !== "string" ||
      !user.displayName.trim() ||
      user.displayName.length > 128 ||
      typeof user.disabled !== "boolean" ||
      !Array.isArray(user.permissions) ||
      user.permissions.some(
        (action) => !["user:read", "user:project", "user:write"].includes(action),
      ) ||
      subjects.has(user.subject) ||
      names.has(user.username.toLowerCase())
    )
      throw new Error("Invalid or duplicate import identity");
    if (
      user.subject !== manifest.guestSubject &&
      !user.disabled &&
      !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(user.bcryptHash || "")
    )
      throw new Error(
        "Every enabled user requires an existing bcrypt hash or explicit offline password reset",
      );
    subjects.add(user.subject);
    names.add(user.username.toLowerCase());
  }
  if (
    !subjects.has(manifest.guestSubject) ||
    !manifest.users.some((user) => user.subject !== manifest.guestSubject && !user.disabled)
  )
    throw new Error("Import requires the original guest and at least one enabled private user");
  return manifest;
}

export async function importCasdoor(config: Settings, input: unknown) {
  const manifest = validateManifest(input, config.issuer);
  // The destination must be fresh. Never point this at Casdoor's old database
  // or schema. Old state and the financial database remain untouched.
  if (!isPostgres(config.database)) {
    const file = await open(config.database, "wx", 0o600);
    await file.close();
  }
  const db = openDatabase(config.database, true);
  try {
    if ("connect" in db) {
      const existing = await db.query("SELECT to_regclass('\"user\"') AS existing");
      if (existing.rows[0].existing) throw new Error("Destination identity schema is not fresh");
    }
    const auth = createAuth(config, db, true);
    await (await getMigrations(auth.options)).runMigrations();
    const ctx = await auth.$context;
    for (const user of manifest.users) {
      const inserted = await ctx.adapter.create<{ id: string }>({
        model: "user",
        forceAllowId: true,
        data: {
          id: user.subject,
          username: user.username.toLowerCase(),
          displayUsername: user.username,
          name: user.displayName,
          email: `${user.subject}@users.invalid`,
          emailVerified: false,
          disabled: user.disabled || user.subject === manifest.guestSubject,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      if (inserted.id !== user.subject)
        throw new Error("Provider changed an imported immutable subject");
      if (user.bcryptHash)
        await ctx.internalAdapter.createAccount({
          accountId: user.subject,
          userId: user.subject,
          providerId: "credential",
          password: user.bcryptHash,
        });
    }
    const owner = manifest.users.find(
      (user) => user.subject !== manifest.guestSubject && !user.disabled,
    )!;
    await registerClient(auth, config);
    await sealIdentity(db, config.issuer, config.clientId);
    return {
      issuer: config.issuer,
      client_id: config.clientId,
      subject: owner.subject,
      guest_subject: manifest.guestSubject,
    };
  } finally {
    await closeDatabase(db);
  }
}

if (import.meta.main) {
  process.umask(0o077);
  const config = settings();
  const manifestPath = process.argv[2],
    output = process.argv[3];
  if (!manifestPath || !output)
    throw new Error("Usage: bun import-casdoor.ts reviewed-manifest.json bootstrap.json");
  const bootstrap = await importCasdoor(config, JSON.parse(await readFile(manifestPath, "utf8")));
  const file = await open(output, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(bootstrap, null, 2));
  } finally {
    await file.close();
  }
}
