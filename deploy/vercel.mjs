const secretVariable = "NET_WORTH_ESTIMATOR_PROXY_SECRET";

export function vercelConfig(env) {
  const backend = origin(env.BACKEND_URL, "BACKEND_URL");
  const publicOrigin = origin(env.NET_WORTH_ESTIMATOR_PUBLIC_URL, "NET_WORTH_ESTIMATOR_PUBLIC_URL");
  if (backend === publicOrigin) throw new Error("BACKEND_URL must differ from the frontend origin");
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(env[secretVariable] || ""))
    throw new Error(`${secretVariable} must contain 32–256 URL-safe characters`);

  return {
    $schema: "https://openapi.vercel.sh/vercel.json",
    framework: null,
    bunVersion: "1.4.x",
    installCommand: "bun install --frozen-lockfile",
    buildCommand: "bun --filter ./frontend api:generate && bun --filter ./frontend typecheck && bun --filter ./frontend build",
    outputDirectory: "frontend/dist",
    devCommand: "bun --filter ./frontend dev",
    // Production deploys come from the gated workflow, not a Git push.
    git: { deploymentEnabled: { main: false } },
    routes: [
      {
        src: "^/(v1(?:/.*)?|healthz|readyz)$",
        has: [{ type: "host", value: { eq: new URL(publicOrigin).host } }],
        dest: `${backend}/$1`,
        headers: { "Cache-Control": "no-store" },
        transforms: [
          {
            type: "request.headers",
            op: "set",
            target: { key: "Waypoint-Proxy-Secret" },
            args: `$${secretVariable}`,
            env: [secretVariable],
          },
          {
            type: "request.headers",
            op: "set",
            target: { key: "Waypoint-Public-Origin" },
            args: publicOrigin,
          },
        ],
      },
      { handle: "filesystem" },
      { src: "/(.*)", dest: "/index.html" },
    ],
  };
}

function origin(raw, name) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS origin`);
  }
  if (
    url.protocol !== "https:" || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash
  ) throw new Error(`${name} must be an absolute HTTPS origin without credentials, path, query, or fragment`);
  return url.origin;
}
