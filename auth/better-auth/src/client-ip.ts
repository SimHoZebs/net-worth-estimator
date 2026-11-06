import { isIP } from "node:net";

// A configured ingress header is trusted only when deployment guarantees that
// every public request passes through an ingress which replaces that header.
// Direct deployments ignore all browser-supplied forwarding headers.
export function withClientAddress(
  request: Request,
  peer: string | undefined,
  ingressHeader?: string,
) {
  const headers = new Headers(request.headers);
  const forwarded = ingressHeader ? headers.get(ingressHeader)?.trim() : undefined;
  const address = forwarded && isIP(forwarded) ? forwarded : peer;
  headers.delete("x-waypoint-client-ip");
  if (address && isIP(address)) headers.set("x-waypoint-client-ip", address);
  return new Request(request, { headers });
}
