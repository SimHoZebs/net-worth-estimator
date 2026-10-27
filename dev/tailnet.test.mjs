import test from "node:test";
import assert from "node:assert/strict";
import { newConfig } from "./config.mjs";
import { checkServe, nodeHostname } from "./tailnet.mjs";

const host = "test-node.example.ts.net";
const node = { BackendState: "Running", Self: { DNSName: `${host}.` }, CertDomains: [host] };
function routes() {
  return {
    TCP: { 5178: { HTTPS: true }, 8000: { HTTPS: true } },
    Web: Object.fromEntries(
      [5178, 8000].map((port) => [
        `${host}:${port}`,
        {
          Handlers: { "/": { Proxy: `http://127.0.0.1:${port}` } },
        },
      ]),
    ),
  };
}

test("tailnet dev verifies the two HTTPS proxies without changing Serve configuration", () => {
  assert.equal(nodeHostname(node), host);
  const serve = routes();
  const before = JSON.stringify(serve);
  checkServe(newConfig(undefined, host), node, serve);
  assert.equal(JSON.stringify(serve), before);
  checkServe(newConfig(), {}, {});
});

test("missing routes, public Funnel, another node, and missing HTTPS support fail closed", () => {
  const config = newConfig(undefined, host);
  assert.throws(() => checkServe(config, node, {}), /route 5178/);
  const wrong = routes();
  wrong.Web[`${host}:8000`].Handlers["/"].Proxy = "http://127.0.0.1:9999";
  assert.throws(() => checkServe(config, node, wrong), /route 8000/);
  assert.throws(
    () => checkServe(config, node, { ...routes(), AllowFunnel: { [`${host}:5178`]: true } }),
    /public Funnel/,
  );
  assert.throws(
    () =>
      checkServe(
        config,
        {
          ...node,
          Self: { DNSName: "other.example.ts.net" },
          CertDomains: ["other.example.ts.net"],
        },
        routes(),
      ),
    /different/,
  );
  assert.throws(() => nodeHostname({ ...node, CertDomains: [] }), /HTTPS certificates/);
  assert.throws(() => nodeHostname({ BackendState: "Stopped" }), /not running/);
});
