import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { vercelConfig } from "./vercel.mjs";

const settings = {
  BACKEND_URL: "https://api.example.test/",
  NET_WORTH_ESTIMATOR_PUBLIC_URL: "https://app.example.test/",
  NET_WORTH_ESTIMATOR_PROXY_SECRET: "0123456789abcdef0123456789abcdef",
};

test("Vercel proxies the API, callbacks, probes, and streams before static fallback", () => {
  const config = vercelConfig(settings);
  const [proxy, filesystem, fallback] = config.routes;
  const pattern = new RegExp(`^${proxy.src}$`);
  for (const path of ["/v1", "/v1/auth/login", "/v1/auth/callback", "/v1/auth/backchannel-logout", "/v1/projections/stochastic", "/healthz", "/readyz"]) {
    assert.equal(path.replace(pattern, proxy.dest), `https://api.example.test${path}`);
  }
  for (const path of ["/", "/assets/app.js", "/settings", "/v10", "/readyz/unexpected"])
    assert.equal(pattern.test(path), false);
  assert.deepEqual(filesystem, { handle: "filesystem" });
  assert.deepEqual(fallback, { src: "/(.*)", dest: "/404.html", status: 404 });
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, "frontend/dist");
  assert.equal(proxy.headers["Cache-Control"], "no-store");
  assert.deepEqual(proxy.has, [{ type: "host", value: { eq: "app.example.test" } }]);
});

test("the edge replaces client ingress headers without embedding the secret", () => {
  const config = vercelConfig(settings);
  const transforms = config.routes[0].transforms;
  assert.deepEqual(transforms, [
    {
      type: "request.headers", op: "set", target: { key: "Waypoint-Proxy-Secret" },
      args: "$NET_WORTH_ESTIMATOR_PROXY_SECRET", env: ["NET_WORTH_ESTIMATOR_PROXY_SECRET"],
    },
    {
      type: "request.headers", op: "set", target: { key: "Waypoint-Public-Origin" },
      args: "https://app.example.test",
    },
  ]);
  assert.equal(JSON.stringify(config).includes(settings.NET_WORTH_ESTIMATOR_PROXY_SECRET), false);
});

test("operator settings change hosts without source changes", () => {
  const config = vercelConfig({ ...settings, BACKEND_URL: "https://different-host.test" });
  assert.equal(config.routes[0].dest, "https://different-host.test/$1");
});

test("Vercel fails closed on incomplete or unsafe deployment settings", () => {
  for (const key of Object.keys(settings)) {
    const env = { ...settings };
    delete env[key];
    assert.throws(() => vercelConfig(env), new RegExp(key));
  }
  for (const value of ["http://api.test", "https://api.test/path", "https://user:pass@api.test", "https://api.test?x=1", "https://api.test#x"]) {
    assert.throws(() => vercelConfig({ ...settings, BACKEND_URL: value }), /BACKEND_URL/);
  }
  assert.throws(() => vercelConfig({ ...settings, BACKEND_URL: settings.NET_WORTH_ESTIMATOR_PUBLIC_URL }), /must differ/);
  assert.throws(() => vercelConfig({ ...settings, NET_WORTH_ESTIMATOR_PROXY_SECRET: "short" }), /PROXY_SECRET/);
});

test("the root config exports the evaluated deployment configuration", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", 'const { config } = await import("./vercel.mjs"); console.log(JSON.stringify(config));'], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, ...settings },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), vercelConfig(settings));
});
