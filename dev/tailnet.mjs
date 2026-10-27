import { originProfile, tailnetOrigins } from "./config.mjs";

export function nodeHostname(status) {
  if (status.BackendState !== "Running" || !status.Self?.DNSName)
    throw new Error("Tailscale is not running on this host");
  const host = status.Self.DNSName.toLowerCase().replace(/\.$/, "");
  tailnetOrigins(host);
  if (!status.CertDomains?.includes(host))
    throw new Error("Enable HTTPS certificates for this node before using tailnet dev");
  return host;
}

export function checkServe(config, nodeStatus, serveStatus) {
  const host = originProfile(config.identity.APP_PUBLIC_URL, config.identity.CASDOOR_PUBLIC_URL);
  if (!host) return;
  if (host !== nodeHostname(nodeStatus))
    throw new Error("Saved dev origins belong to a different Tailscale node");
  for (const port of [5178, 8000]) {
    const key = `${host}:${port}`;
    const handler = serveStatus.Web?.[key]?.Handlers?.["/"];
    if (serveStatus.AllowFunnel?.[key])
      throw new Error(`Port ${port} has public Funnel access. Dev requires tailnet-only Serve.`);
    if (!serveStatus.TCP?.[port]?.HTTPS || handler?.Proxy !== `http://127.0.0.1:${port}`) {
      throw new Error(
        `Tailnet HTTPS route ${port} is missing or differs. Configure the two approved Serve routes from dev/README.md. No Tailscale configuration was changed.`,
      );
    }
  }
}
