// Disposable development/test fixtures only. Excluded from deployment images.
import { setup as initialize } from "./src/setup";
import { createAuth } from "./src/auth";
import { openDatabase, closeDatabase } from "./src/database";
import { settings, type Settings } from "./src/config";
import { handler } from "./src/server";

interface Signup {
  username: string;
  password: string;
  name: string;
}

async function createUser(
  issuer: string,
  input: Signup,
  send: (request: Request) => Promise<Response>,
) {
  const response = await send(
    new Request(`${issuer}/sign-up`, {
      method: "POST",
      headers: { origin: issuer },
      body: new URLSearchParams({ username: input.username, password: input.password }),
    }),
  );
  if (response.status !== 303) throw new Error(`Fixture signup rejected (${response.status})`);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const checked = await send(
    new Request(`${issuer}/api/auth/get-session`, { headers: { cookie } }),
  );
  const session = (await checked.json()) as { user?: { id: string; username: string } } | null;
  if (!checked.ok || !session?.user) throw new Error("Fixture signup did not establish a session");
  return { subject: session.user.id, username: session.user.username };
}

export async function setup(config: Settings, user: Signup) {
  await initialize(config);
  const db = openDatabase(config.database);
  try {
    const auth = createAuth(config, db),
      send = handler(auth, config);
    const account = await createUser(config.issuer, user, send);
    const guest = await createUser(
      config.issuer,
      { username: `guest-${crypto.randomUUID()}`, password: crypto.randomUUID(), name: "Guest" },
      send,
    );
    const ctx = await auth.$context;
    await ctx.internalAdapter.updateUser(guest.subject, { disabled: true });
    await ctx.internalAdapter.deleteUserSessions(account.subject);
    await ctx.internalAdapter.deleteUserSessions(guest.subject);
    return {
      issuer: config.issuer,
      client_id: config.clientId,
      subject: account.subject,
      guest_subject: guest.subject,
      username: account.username,
    };
  } finally {
    await closeDatabase(db);
  }
}

if (import.meta.main) {
  process.umask(0o077);
  const config = settings();
  const username = process.env.TEST_AUTH_USER_NAME,
    password = process.env.TEST_AUTH_USER_PASSWORD;
  if (!username || !password)
    throw new Error("Disposable fixtures require explicit test credentials");
  const fixture = await setup(config, {
    username,
    password,
    name: process.env.TEST_AUTH_USER_DISPLAY_NAME || username,
  });
  await Bun.write(`${config.database}.bootstrap.json`, JSON.stringify(fixture), { mode: 0o600 });
}
