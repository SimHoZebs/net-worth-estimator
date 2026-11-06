import { betterAuth } from "better-auth";
import { bearer, jwt, username } from "better-auth/plugins";
import { oauthProvider, oauthDeviceAuthorization } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import type { Settings } from "./config";
import { disabledUser, revokeSessionTokens, type IdentityDatabase } from "./database";

export function createAuth(config: Settings, database: IdentityDatabase, provisioning = false) {
  return betterAuth({
    appName: "Waypoint",
    baseURL: config.issuer,
    basePath: "/api/auth",
    secret: config.secret,
    database,
    trustedOrigins: [config.issuer],
    disabledPaths: ["/token", "/is-username-available"],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 72,
      password: {
        hash: (password) => Bun.password.hash(password, { algorithm: "bcrypt", cost: 12 }),
        verify: ({ password, hash }) => Bun.password.verify(password, hash, "bcrypt"),
      },
    },
    user: {
      additionalFields: {
        disabled: { type: "boolean", defaultValue: false, input: false },
      },
    },
    session: { expiresIn: 30 * 24 * 3600, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database" },
    advanced: {
      database: { validateSchema: !provisioning },
      ipAddress: { ipAddressHeaders: ["x-waypoint-client-ip"] },
      cookiePrefix: `waypoint-auth-${Bun.hash(config.issuer).toString(16)}`,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, hook) => {
            // Use the provider's transaction-aware adapter during signup. A second
            // PostgreSQL connection cannot see the uncommitted new user.
            if (hook) {
              const user = (await hook.context.internalAdapter.findUserById(session.userId)) as {
                disabled?: boolean;
              } | null;
              if (!user || user.disabled) return false;
            } else if (await disabledUser(database, session.userId)) return false;
          },
        },
        delete: {
          before: async (session) => {
            // Waypoint logout revokes offline access too. Otherwise ON DELETE SET
            // NULL detaches tokens from the session and can leave them active.
            await revokeSessionTokens(database, session.id);
          },
        },
      },
    },
    plugins: [
      username({
        minUsernameLength: 1,
        maxUsernameLength: 64,
        usernameValidator: (name) => /^[\p{L}\p{N}_.@-]+$/u.test(name),
      }),
      bearer(),
      jwt({ jwt: { issuer: config.issuer }, jwks: { keyPairConfig: { alg: "RS256" } } }),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        signup: { page: "/sign-up" },
        generateClientId: () => config.clientId,
        generateClientSecret: () => config.clientSecret,
        customAccessTokenClaims: ({ user }) => ({ name: user?.name }),
        // The first-party client belongs to infrastructure, not a user.
        canRegisterClient: () => false,
      }),
      oauthDeviceAuthorization({ verificationUri: `${config.issuer}/device` }),
      passkey({ rpID: new URL(config.issuer).hostname, rpName: "Waypoint", origin: config.issuer }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
