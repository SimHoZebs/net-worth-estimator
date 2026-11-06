import type { Auth } from "./auth";
import type { Settings } from "./config";

// Server-only provisioning. This operation is never exposed over HTTP.
export function registerClient(auth: Auth, config: Settings, sessionToken: string) {
  const apps = [config.appUrl, ...Object.keys(config.browserOrigins || {})];
  return auth.api.adminCreateOAuthClient({
    headers: new Headers({ authorization: `Bearer ${sessionToken}`, origin: config.issuer }),
    body: {
      client_name: "Waypoint",
      redirect_uris: apps.map((app) => `${app}/v1/auth/callback`),
      application_type: new URL(config.appUrl).protocol === "http:" ? "native" : "web",
      post_logout_redirect_uris: apps.map((app) => `${app}/`),
      backchannel_logout_uri:
        config.backchannelUrl ||
        (config.appUrl.startsWith("https:")
          ? `${config.appUrl}/v1/auth/backchannel-logout`
          : undefined),
      token_endpoint_auth_method: "client_secret_basic",
      skip_consent: true,
      enable_end_session: true,
      require_pkce: true,
      subject_type: "public",
      grant_types: [
        "authorization_code",
        "refresh_token",
        "urn:ietf:params:oauth:grant-type:device_code",
      ],
      scope: "openid profile email offline_access",
    },
  });
}
