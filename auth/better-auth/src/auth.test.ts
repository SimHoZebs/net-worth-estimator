import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup } from "../test-support";
import { createAuth } from "./auth";
import { openDatabase, closeDatabase, verifyIdentity } from "./database";
import { handler } from "./server";
import { accountRequest } from "./account";

test("real provider: signup, OIDC PKCE, introspection, refresh, account and revocation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "waypoint-auth-"));
  const config = {
    issuer: "http://localhost:9800",
    appUrl: "http://localhost:9801",
    database: process.env.AUTH_TEST_POSTGRES || join(dir, "identity.db"),
    secret: "auth-secret-123456789012345678901234",
    clientId: "waypoint",
    clientSecret: "client-secret-123456789012345678901234",
    backchannelUrl: undefined,
  };
  let db: ReturnType<typeof openDatabase> | undefined;
  try {
    const bootstrap = await setup(config, {
      username: "owner",
      password: "test-password",
      name: "Owner",
    });
    db = openDatabase(config.database);
    await verifyIdentity(db, config.issuer, config.clientId);
    await expect(
      verifyIdentity(db, "https://wrong-issuer.test", config.clientId),
    ).rejects.toThrow();
    const auth = createAuth(config, db);
    const serve = handler(auth, config);
    let cookie = "";
    const request = async (path: string, options: RequestInit = {}) => {
      const headers = new Headers(options.headers);
      if (cookie) headers.set("cookie", cookie);
      const response = await serve(new Request(config.issuer + path, { ...options, headers }));
      const cookies = response.headers.getSetCookie();
      if (cookies.length) cookie = cookies.map((value) => value.split(";")[0]).join("; ");
      return response;
    };
    const json = (body: unknown) => ({
      method: "POST",
      headers: { "content-type": "application/json", origin: config.issuer },
      body: JSON.stringify(body),
    });
    const metadata = await (await request("/.well-known/openid-configuration")).json();
    expect(metadata.issuer).toBe(config.issuer);
    expect(metadata.backchannel_logout_supported).toBe(true);
    const nativeVerifier = "b".repeat(43);
    const nativeChallenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nativeVerifier)),
    ).toString("base64url");
    const nativeQuery = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `${config.appUrl}/v1/auth/callback`,
      response_type: "code",
      scope: "openid profile offline_access",
      state: "native-state",
      nonce: "native-nonce",
      code_challenge: nativeChallenge,
      code_challenge_method: "S256",
    });
    const nativeAuthorize = await request(`/api/auth/oauth2/authorize?${nativeQuery}`);
    expect(nativeAuthorize.status).toBe(302);
    const login = new URL(nativeAuthorize.headers.get("location")!, config.issuer);
    const nativeSignIn = await request(`${login.pathname}${login.search}`, {
      method: "POST",
      headers: { origin: config.issuer },
      body: new URLSearchParams({ username: "owner", password: "test-password" }),
    });
    expect(nativeSignIn.status).toBe(303);
    expect(new URL(nativeSignIn.headers.get("location")!).origin).toBe(config.appUrl);
    const signIn = await request(
      "/api/auth/sign-in/username",
      json({ username: "owner", password: "test-password" }),
    );
    expect(signIn.status).toBe(200);
    const signedIn = await signIn.json();
    const verifier = "a".repeat(43);
    const challenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ).toString("base64url");
    const query = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `${config.appUrl}/v1/auth/callback`,
      response_type: "code",
      scope: "openid profile email offline_access",
      state: "test-state",
      nonce: "test-nonce",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const authorize = await request(`/api/auth/oauth2/authorize?${query}`);
    expect(authorize.status).toBe(302);
    const callback = new URL(authorize.headers.get("location")!);
    expect(callback.searchParams.get("state")).toBe("test-state");
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();
    const exchange = async (values: Record<string, string>, path = "/api/auth/oauth2/token") =>
      request(path, {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(values),
      });
    const tokensResponse = await exchange({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: `${config.appUrl}/v1/auth/callback`,
      code_verifier: verifier,
    });
    expect(tokensResponse.status).toBe(200);
    const tokens = await tokensResponse.json();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.id_token).toBeTruthy();
    const claims = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString());
    expect(claims.sub).toBe(bootstrap.subject);
    expect(claims.nonce).toBe("test-nonce");
    const introspection = await (
      await exchange(
        { token: tokens.access_token, token_type_hint: "access_token" },
        "/api/auth/oauth2/introspect",
      )
    ).json();
    expect(introspection.active).toBe(true);
    expect(introspection.iss).toBe(config.issuer);
    expect(introspection.client_id).toBe(config.clientId);
    expect(introspection.sub).toBe(bootstrap.subject);
    const profile = await accountRequest(
      auth,
      config,
      new Request(`${config.issuer}/waypoint/account`, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }),
    );
    expect(profile.status).toBe(200);
    expect((await profile.json()).subject).toBe(bootstrap.subject);
    const context = await auth.$context;
    await context.adapter.update({
      model: "user",
      where: [{ field: "id", value: bootstrap.subject }],
      update: { disabled: true },
    });
    const disabled = await (
      await exchange(
        { token: tokens.access_token, token_type_hint: "access_token" },
        "/api/auth/oauth2/introspect",
      )
    ).json();
    expect(disabled.active).toBe(false);
    await context.adapter.update({
      model: "user",
      where: [{ field: "id", value: bootstrap.subject }],
      update: { disabled: false },
    });
    const updated = await request("/waypoint/account", {
      ...json({ displayName: "Updated owner" }),
      headers: { ...json({}).headers, authorization: `Bearer ${tokens.access_token}` },
    });
    expect(updated.status).toBe(200);
    const refreshed = await exchange({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    const rotated = await refreshed.json();
    expect(rotated.id_token).toBeTruthy();
    const started = await exchange(
      { client_id: config.clientId, scope: "openid profile offline_access" },
      "/api/auth/device/code",
    );
    expect(started.status).toBe(200);
    const device = await started.json();
    expect(device.verification_uri).toBe(`${config.issuer}/device`);
    const pending = await exchange({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: device.device_code,
      client_id: config.clientId,
    });
    expect((await pending.json()).error).toBe("authorization_pending");
    const claimed = await request(
      `/api/auth/device?user_code=${encodeURIComponent(device.user_code)}`,
    );
    expect(claimed.status).toBe(200);
    const approved = await request(
      "/api/auth/device/approve",
      json({ userCode: device.user_code }),
    );
    expect({ status: approved.status, body: await approved.json() }).toMatchObject({ status: 200 });
    const forged = await request("/sign-in", {
      method: "POST",
      headers: { origin: "https://evil.test" },
      body: new URLSearchParams({ username: "owner", password: "test-password" }),
    });
    expect(forged.status).toBe(403);
    const changed = await request("/waypoint/account/password", {
      ...json({ oldPassword: "test-password", newPassword: "new-test-password" }),
      headers: { ...json({}).headers, authorization: `Bearer ${rotated.access_token}` },
    });
    expect({ status: changed.status, body: await changed.json() }).toMatchObject({
      status: 200,
      body: { reauth: true },
    });
    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteUserSessions(signedIn.user.id);
    const revoked = await (
      await exchange(
        { token: rotated.access_token, token_type_hint: "access_token" },
        "/api/auth/oauth2/introspect",
      )
    ).json();
    expect(revoked.active).toBe(false);
  } finally {
    if (db) await closeDatabase(db);
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
