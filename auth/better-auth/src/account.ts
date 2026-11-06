import type { Auth } from "./auth";
import type { Settings } from "./config";

// OAuth access tokens and first-party Better Auth sessions are distinct.
// Bind both before forwarding account operations through Better Auth's APIs.
export async function accountRequest(auth: Auth, config: Settings, request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return Response.json({ error: "Sign in to manage your account." }, { status: 401 });
  const checked = await auth.handler(
    new Request(`${config.issuer}/api/auth/oauth2/introspect`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token, token_type_hint: "access_token" }),
    }),
  );
  if (!checked.ok) throw new Error("Token verification unavailable");
  const introspection = await checked.json();
  const identity = introspection as {
    active: boolean;
    sub?: string;
    client_id?: string;
    sid?: string;
  };
  if (!identity.active || !identity.sub || identity.client_id !== config.clientId)
    return Response.json({ error: "The account is no longer active." }, { status: 401 });
  const ctx = await auth.$context;
  const user = await ctx.adapter.findOne<typeof auth.$Infer.Session.user>({
    model: "user",
    where: [{ field: "id", value: identity.sub }],
  });
  if (!user || user.disabled)
    return Response.json({ error: "The account is no longer active." }, { status: 401 });
  const profile = () => ({
    subject: user.id,
    owner: "waypoint",
    name: user.username || user.id,
    displayName: user.name,
    avatar: user.image || "",
  });
  if (request.method === "GET") return Response.json(profile());
  if (!identity.sid)
    return Response.json({ error: "A browser sign-in is required." }, { status: 401 });
  const session = await ctx.adapter.findOne<{ token: string; userId: string }>({
    model: "session",
    where: [{ field: "id", value: identity.sid }],
  });
  if (!session || session.userId !== user.id)
    return Response.json({ error: "The account is no longer active." }, { status: 401 });
  const headers = new Headers({ authorization: `Bearer ${session.token}`, origin: config.issuer });
  const body = await request.json();
  try {
    if (new URL(request.url).pathname.endsWith("/password")) {
      await auth.api.changePassword({
        headers,
        body: {
          currentPassword: body.oldPassword,
          newPassword: body.newPassword,
          revokeOtherSessions: true,
        },
      });
      await ctx.internalAdapter.deleteUserSessions(user.id);
      return Response.json({ reauth: true });
    }
    await auth.api.updateUser({
      headers,
      body: {
        ...(body.displayName === undefined ? {} : { name: body.displayName }),
        ...(body.avatar === undefined ? {} : { image: body.avatar }),
      },
    });
    const updated = await ctx.internalAdapter.findUserById(user.id);
    return Response.json({
      ...profile(),
      displayName: updated?.name,
      avatar: updated?.image || "",
    });
  } catch (error) {
    // Better Auth validation is safe to display. Internal errors remain private.
    const message = (error as { body?: { message?: string } }).body?.message;
    return Response.json(
      { error: message || "The account update was rejected." },
      { status: message ? 400 : 503 },
    );
  }
}
