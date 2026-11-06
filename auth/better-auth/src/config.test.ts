import { test, expect } from "bun:test";
import { settings } from "./config";

test("identity settings require distinct secrets and exact secure origins", () => {
  const base = {
    AUTH_PUBLIC_URL: "http://localhost:9800",
    APP_PUBLIC_URL: "http://localhost:9801",
    AUTH_DATABASE: "/private/identity.db",
    AUTH_CLIENT_ID: "waypoint",
    AUTH_CLIENT_SECRET: "client-secret-123456789012345678901234",
    BETTER_AUTH_SECRET: "auth-secret-123456789012345678901234",
  };
  expect(settings(base).issuer).toBe(base.AUTH_PUBLIC_URL);
  for (const overrides of [
    { BETTER_AUTH_SECRET: "short" },
    { BETTER_AUTH_SECRET: base.AUTH_CLIENT_SECRET },
    { AUTH_PUBLIC_URL: "https://auth.test/path" },
    { APP_PUBLIC_URL: "http://192.168.1.5:8000" },
    { NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS: "[]" },
    { NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS: '{"https://app.test":"ftp://identity.test"}' },
  ])
    expect(() => settings({ ...base, ...overrides })).toThrow();
});
