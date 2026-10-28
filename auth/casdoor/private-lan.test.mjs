import test from "node:test";
import assert from "node:assert/strict";
import { allowPrivateHTTP, isLoopbackHostname, origin } from "./private-lan.mjs";

test("loopback detection covers localhost and loopback literals", () => {
  for (const host of ["localhost", "127.0.0.1", "::1", "[::1]", "LOCALHOST"]) {
    assert.equal(isLoopbackHostname(host), true, host);
  }
  for (const host of ["", "192.168.1.50", "myserver", "nas.local", "8.8.8.8"]) {
    assert.equal(isLoopbackHostname(host), false, host);
  }
});

test("origin requires flag for non-loopback HTTP", () => {
  assert.throws(() => origin("http://192.168.1.50:8080", "APP_PUBLIC_URL", false));
  assert.equal(
    origin("http://192.168.1.50:8080", "APP_PUBLIC_URL", true),
    "http://192.168.1.50:8080",
  );
  assert.equal(
    origin("http://8.8.8.8:8080", "APP_PUBLIC_URL", true),
    "http://8.8.8.8:8080",
  );
  assert.equal(origin("http://localhost:8080", "APP_PUBLIC_URL", false), "http://localhost:8080");
});

test("flag parsing accepts only explicit opt-in values", () => {
  for (const value of ["1", "true", "yes", "TRUE", " Yes "]) {
    assert.equal(allowPrivateHTTP({ NET_WORTH_ESTIMATOR_ALLOW_PRIVATE_HTTP: value }), true);
  }
  for (const value of ["", "0", "false", "no", "lan"]) {
    assert.equal(allowPrivateHTTP({ NET_WORTH_ESTIMATOR_ALLOW_PRIVATE_HTTP: value }), false);
  }
  assert.equal(allowPrivateHTTP({}), false);
});
