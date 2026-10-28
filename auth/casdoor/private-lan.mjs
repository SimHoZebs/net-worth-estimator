export function allowPrivateHTTP(env) {
  const value = String(env.NET_WORTH_ESTIMATOR_ALLOW_PRIVATE_HTTP ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function isLoopbackHostname(hostname) {
  const host = String(hostname ?? "").trim().toLowerCase().replace(/\.$/, "");
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return bare === "localhost" || bare === "127.0.0.1" || bare === "::1";
}

export function origin(value, name, allowInsecure = false) {
  const url = new URL(value);
  const loopback = isLoopbackHostname(url.hostname);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (url.protocol === "http:" && !loopback && !allowInsecure)
  ) {
    throw new Error(
      `${name} requires HTTPS except on loopback (set NET_WORTH_ESTIMATOR_ALLOW_PRIVATE_HTTP=1 to allow plain HTTP on a trusted LAN)`,
    );
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be an origin without credentials, path, query, or fragment`);
  }
  return url.origin;
}
