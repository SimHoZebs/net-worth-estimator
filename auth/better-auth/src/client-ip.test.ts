import { expect, test } from "bun:test";
import { withClientAddress } from "./client-ip";

test("direct clients cannot spoof rate-limit addresses", () => {
  const request = new Request("https://identity.test/sign-in", {
    headers: {
      "x-waypoint-client-ip": "203.0.113.10",
      "x-forwarded-for": "203.0.113.11",
      "x-envoy-external-address": "203.0.113.12",
    },
  });
  expect(withClientAddress(request, "192.0.2.1").headers.get("x-waypoint-client-ip")).toBe(
    "192.0.2.1",
  );
});

test("an explicitly trusted ingress preserves distinct clients and rejects malformed addresses", () => {
  for (const address of ["198.51.100.1", "198.51.100.2"]) {
    // Simulate the documented Northflank public-ingress contract: it replaces
    // the client's supplied value before forwarding to this service.
    const request = new Request("https://identity.test/sign-in", {
      headers: {
        "x-waypoint-client-ip": "spoofed",
        "x-envoy-external-address": address,
        "x-forwarded-for": "203.0.113.100, 203.0.113.200",
      },
    });
    expect(
      withClientAddress(request, "10.0.0.1", "x-envoy-external-address").headers.get(
        "x-waypoint-client-ip",
      ),
    ).toBe(address);
  }
  const malformed = new Request("https://identity.test/sign-in", {
    headers: { "x-envoy-external-address": "198.51.100.1, 198.51.100.2" },
  });
  expect(
    withClientAddress(malformed, "10.0.0.1", "x-envoy-external-address").headers.get(
      "x-waypoint-client-ip",
    ),
  ).toBe("10.0.0.1");
});
