import { createHash } from "node:crypto";
import type { Auth } from "./auth";
import type { Settings } from "./config";

// Infrastructure configuration for the single first-party OAuth client.
// It has no human owner and requires no user, credential account, or session.
// Better Auth 1.7.18 stores confidential-client secrets as base64url SHA-256.
export async function registerClient(auth: Auth, config: Settings) {
  const apps = [config.appUrl, ...Object.keys(config.browserOrigins || {})];
  const ctx = await auth.$context;
  await ctx.adapter.create({
    model: "oauthClient",
    data: {
      clientId: config.clientId,
      clientSecret: createHash("sha256").update(config.clientSecret).digest("base64url"),
      name: "Waypoint",
      redirectUris: apps.map((app) => `${app}/v1/auth/callback`),
      postLogoutRedirectUris: apps.map((app) => `${app}/`),
      backchannelLogoutUri:
        config.backchannelUrl ||
        (config.appUrl.startsWith("https:")
          ? `${config.appUrl}/v1/auth/backchannel-logout`
          : undefined),
      applicationType: new URL(config.appUrl).protocol === "http:" ? "native" : "web",
      tokenEndpointAuthMethod: "client_secret_basic",
      skipConsent: true,
      enableEndSession: true,
      requirePKCE: true,
      subjectType: "public",
      grantTypes: [
        "authorization_code",
        "refresh_token",
        "urn:ietf:params:oauth:grant-type:device_code",
      ],
      scopes: ["openid", "profile", "email", "offline_access"],
      clientCredentialsScopes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}
