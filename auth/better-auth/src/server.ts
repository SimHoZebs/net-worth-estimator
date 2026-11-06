import { getMigrations } from "better-auth/db/migration";
import {
  oauthProviderOpenIdConfigMetadata,
  oauthProviderAuthServerMetadata,
} from "@better-auth/oauth-provider";
import { createAuth, type Auth } from "./auth";
import { openDatabase, verifyIdentity } from "./database";
import { settings, type Settings } from "./config";
import { accountRequest } from "./account";
import { page } from "./pages";
import { withClientAddress } from "./client-ip";

export function handler(auth: Auth, config: Settings) {
  return async (request: Request) => {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const html = (path: string, query: string, message = "", status = 200) =>
      new Response(page(path, query, message, nonce), {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    const url = new URL(request.url);
    let response: Response;
    try {
      if (url.pathname === "/healthz") response = new Response("ok");
      else if (url.pathname === "/.well-known/openid-configuration")
        response = await oauthProviderOpenIdConfigMetadata(auth)(request);
      else if (url.pathname === "/.well-known/oauth-authorization-server")
        response = await oauthProviderAuthServerMetadata(auth)(request);
      else if (url.pathname.startsWith("/waypoint/account"))
        response = await accountRequest(auth, config, request);
      else if (url.pathname === "/assets/auth.css" || url.pathname === "/assets/client.js") {
        response = new Response(
          Bun.file(new URL(`../public/${url.pathname.split("/").pop()}`, import.meta.url)),
        );
      } else if (["/sign-in", "/sign-up", "/device", "/account"].includes(url.pathname)) {
        if (request.method === "GET") {
          const needsSession = url.pathname === "/device" || url.pathname === "/account";
          const session = needsSession
            ? await auth.api.getSession({ headers: request.headers })
            : null;
          response =
            needsSession && !session
              ? new Response(null, {
                  status: 303,
                  headers: { Location: `/sign-in?callbackURL=${url.pathname}` },
                })
              : html(url.pathname, url.search);
        } else if (
          request.method === "POST" &&
          request.headers.get("origin") === config.issuer &&
          request.headers.get("sec-fetch-site") !== "cross-site"
        ) {
          const form = await request.formData();
          const username = String(form.get("username") || "").toLowerCase();
          const signup = url.pathname === "/sign-up";
          const callback =
            url.searchParams.get("callbackURL") === "/device" ? "/device" : "/account";
          const endpoint =
            url.pathname === "/device"
              ? `/device/${form.get("decision") === "approve" ? "approve" : "deny"}`
              : signup
                ? "/sign-up/email"
                : "/sign-in/username";
          const payload =
            url.pathname === "/device"
              ? { userCode: form.get("userCode") }
              : {
                  username,
                  password: form.get("password"),
                  oauth_query: url.searchParams.has("sig") ? url.search.slice(1) : undefined,
                  callbackURL: `${config.issuer}${callback}`,
                  ...(signup
                    ? { email: `${crypto.randomUUID()}@users.invalid`, name: form.get("name") }
                    : {}),
                };
          const headers = new Headers(request.headers);
          headers.set("Content-Type", "application/json");
          headers.delete("content-length");
          const verified =
            url.pathname === "/device"
              ? await auth.handler(
                  new Request(
                    `${config.issuer}/api/auth/device?user_code=${encodeURIComponent(String(form.get("userCode") || ""))}`,
                    { headers },
                  ),
                )
              : null;
          const result =
            verified && !verified.ok
              ? verified
              : await auth.handler(
                  new Request(`${config.issuer}/api/auth${endpoint}`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload),
                  }),
                );
          const location = result.headers.get("location");
          const redirects = result.status >= 300 && result.status < 400 && location;
          const body =
            !redirects && result.headers.get("content-type")?.includes("application/json")
              ? await result.json()
              : {};
          if (result.status >= 300 && result.status < 400 && location)
            response = new Response(null, { status: 303, headers: { Location: location } });
          else if (!result.ok)
            response = html(
              url.pathname,
              url.search,
              body.message || "The request did not complete.",
              result.status,
            );
          else {
            const destination = body.url || (url.pathname === "/device" ? "/device" : callback);
            response = new Response(null, { status: 303, headers: { Location: destination } });
          }
          for (const cookie of result.headers.getSetCookie())
            response.headers.append("Set-Cookie", cookie);
        } else response = new Response("Forbidden", { status: 403 });
      } else if (url.pathname.startsWith("/api/auth/")) {
        response = await auth.handler(request);
        if (url.pathname === "/api/auth/oauth2/introspect" && response.ok) {
          const result = await response.json();
          if (result.active && result.sub) {
            const ctx = await auth.$context;
            const user = await ctx.adapter.findOne<typeof auth.$Infer.Session.user>({
              model: "user",
              where: [{ field: "id", value: result.sub }],
            });
            if (!user || user.disabled) {
              response = Response.json({ active: false });
            } else response = Response.json(result);
          } else response = Response.json(result);
        }
      } else response = new Response("Not found", { status: 404 });
    } catch (error) {
      // Omit messages and request queries: provider errors can embed credentials.
      console.error(
        "Identity request failed",
        error instanceof Error ? error.name : "UnknownError",
        error instanceof Error ? error.stack?.split("\n").slice(1, 3).join("\n") : "",
      );
      response = Response.json(
        { error: "Identity service is temporarily unavailable." },
        { status: 503 },
      );
    }
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-Frame-Options", "DENY");
    const callbacks = [config.appUrl, ...Object.keys(config.browserOrigins || {})]
      .map((app) => `${app}/v1/auth/callback`)
      .join(" ");
    // Chromium applies form-action to redirect targets too. Permit only the
    // registered application callbacks, not arbitrary redirect destinations.
    response.headers.set(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic' 'report-sample'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; form-action 'self' ${callbacks}`,
    );
    return response;
  };
}

if (import.meta.main) {
  const config = settings();
  const database = openDatabase(config.database);
  await verifyIdentity(database, config.issuer, config.clientId);
  const auth = createAuth(config, database);
  const migration = await getMigrations(auth.options);
  if (migration.toBeCreated.length || migration.toBeAdded.length)
    throw new Error("Identity schema is incomplete. Run explicit setup or import before startup.");
  const serve = handler(auth, config);
  Bun.serve({
    hostname: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 8000),
    maxRequestBodySize: 64 * 1024,
    fetch(request, server) {
      return serve(
        withClientAddress(request, server.requestIP(request)?.address, config.clientIPHeader),
      );
    },
  });
}
