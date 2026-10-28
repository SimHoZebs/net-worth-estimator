import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const image = process.env.DEPLOYMENT_TEST_IMAGE;

test("API image supports non-root command overrides, explicit setup, and probes on a provider port", { skip: !image }, async (t) => {
  const { stdout } = await run("docker", ["image", "inspect", image]);
  const config = JSON.parse(stdout)[0].Config;
  assert.equal(config.User, "app:app");
  assert.deepEqual(config.Cmd, ["/app/server"]);
  assert.ok(!config.Entrypoint || config.Entrypoint.length === 0);
  assert.match(config.Healthcheck.Test[1], /\$\{PORT\}\/readyz/);
  const name = `waypoint-deployment-test-${randomUUID()}`;
  const fixture = `
set -eu
test "$(id -u)" = 10001
test -d "$HOME/.ssh"
test "$(stat -c %a "$HOME/.ssh")" = 700
mkdir -p /tmp/provider/.well-known
cat > /tmp/provider/.well-known/openid-configuration <<'JSON'
{"issuer":"http://127.0.0.1:18000","authorization_endpoint":"http://127.0.0.1:18000/authorize","token_endpoint":"http://127.0.0.1:18000/token","jwks_uri":"http://127.0.0.1:18000/jwks","introspection_endpoint":"http://127.0.0.1:18000/introspect","backchannel_logout_supported":true}
JSON
busybox-extras httpd -p 18000 -h /tmp/provider
/app/setupdb --db "$NET_WORTH_ESTIMATOR_DB"
exec /app/server
`;
  await run("docker", [
    "run", "--detach", "--network", "none", "--name", name,
    "--env", "PORT=10000",
    "--env", "NET_WORTH_ESTIMATOR_AUTH_ISSUER=http://127.0.0.1:18000",
    "--env", "NET_WORTH_ESTIMATOR_AUTH_CLIENT_ID=fixture",
    "--env", "NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET=fixture-secret",
    "--env", "NET_WORTH_ESTIMATOR_PUBLIC_URL=http://localhost:8080",
    "--env", "NET_WORTH_ESTIMATOR_PROXY_SECRET=0123456789abcdef0123456789abcdef",
    image, "/bin/sh", "-c", fixture,
  ]);
  t.after(async () => {
    await run("docker", ["rm", "--force", name]).catch(() => {});
  });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const { stdout } = await run("docker", ["exec", name, "/bin/sh", "-c", config.Healthcheck.Test[1]]);
      assert.equal(stdout, "ok");
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const logs = await run("docker", ["logs", name]);
  assert.ok(ready, `API did not become ready: ${logs.stdout}\n${logs.stderr}`);
  const denied = await run("docker", ["exec", name, "wget", "--server-response", "-O", "/dev/null", "http://127.0.0.1:10000/v1/auth/session"])
    .then(() => "unexpected success", (error) => error.stderr);
  assert.match(denied, /403 Forbidden/);
});
