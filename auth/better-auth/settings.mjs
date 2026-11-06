// Node-compatible configuration shared by the dev CLI and explicit provisioning.
export function settingsFromEnv(env) {
  const required = (name) => {
    if (!env[name]) throw new Error(`${name} is required`);
    return env[name];
  };
  const publicUrl = required("AUTH_PUBLIC_URL");
  const appUrl = required("APP_PUBLIC_URL");
  for (const value of [publicUrl, appUrl]) {
    const url = new URL(value);
    if (url.origin !== value || !["http:", "https:"].includes(url.protocol))
      throw new Error("Auth and app URLs must be exact HTTP/S origins");
  }
  return {
    publicUrl,
    appUrl,
    clientId: required("AUTH_CLIENT_ID"),
    clientSecret: required("AUTH_CLIENT_SECRET"),
    secret: required("BETTER_AUTH_SECRET"),
    username: required("AUTH_USER_NAME"),
    password: required("AUTH_USER_PASSWORD"),
    displayName: env.AUTH_USER_DISPLAY_NAME || env.AUTH_USER_NAME,
  };
}
