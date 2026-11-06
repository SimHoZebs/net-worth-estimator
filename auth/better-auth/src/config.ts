export interface Settings {
  issuer: string;
  appUrl: string;
  database: string;
  secret: string;
  clientId: string;
  clientSecret: string;
  backchannelUrl?: string;
  browserOrigins?: Record<string, string>;
  clientIPHeader?: string;
}

export function settings(env: Record<string, string | undefined> = process.env): Settings {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const origin = (name: string, value = required(name)) => {
    const url = new URL(value);
    if (
      url.origin !== value ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    ) {
      throw new Error(`${name} must be an HTTPS origin (HTTP is supported only on loopback)`);
    }
    return value;
  };
  const secret = required("BETTER_AUTH_SECRET");
  const clientSecret = required("AUTH_CLIENT_SECRET");
  if (secret.length < 32 || clientSecret.length < 32 || secret === clientSecret)
    throw new Error("Use distinct auth and client secrets of at least 32 characters");
  const browserOrigins = JSON.parse(env.NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS || "{}");
  const clientIPHeader = env.AUTH_CLIENT_IP_HEADER?.toLowerCase();
  if (
    clientIPHeader &&
    (!/^[a-z0-9-]+$/.test(clientIPHeader) || clientIPHeader === "x-waypoint-client-ip")
  )
    throw new Error("AUTH_CLIENT_IP_HEADER must name a trusted ingress-owned header");
  if (!browserOrigins || Array.isArray(browserOrigins) || typeof browserOrigins !== "object")
    throw new Error("AUTH_BROWSER_ORIGINS must map app origins to provider origins");
  for (const [app, provider] of Object.entries(browserOrigins)) {
    if (typeof provider !== "string") throw new Error("Browser aliases must be exact origins");
    origin("browser app", app);
    origin("browser provider", provider);
  }
  return {
    issuer: origin("AUTH_PUBLIC_URL"),
    appUrl: origin("APP_PUBLIC_URL"),
    database: required("AUTH_DATABASE"),
    secret,
    clientId: required("AUTH_CLIENT_ID"),
    clientSecret,
    backchannelUrl: env.AUTH_BACKCHANNEL_LOGOUT_URL,
    browserOrigins,
    clientIPHeader,
  };
}
