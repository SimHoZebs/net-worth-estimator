import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import test from "node:test";

const image = process.env.NGINX_TEST_IMAGE;

test(
  "provider gateway accepts Casdoor-sized headers that fail with the default buffer",
  { skip: !image },
  async () => {
    const directory = await mkdtemp("/tmp/opencode/nginx-provider-headers-");
    const source = await readFile(
      new URL("../frontend/nginx.conf.template", import.meta.url),
      "utf8",
    );
    const logoChunk = "x".repeat(599);
    const upstream = `
server {
  listen 18082;
  location ~ ^/(healthz|readyz)$ {
    if ($http_cookie != "") { return 400; }
    if ($http_authorization != "") { return 400; }
    return 200 "ok";
  }
  location / {
    set $logo_chunk "${logoChunk}";
    set $logo "${"$logo_chunk".repeat(8)}";
    add_header Set-Cookie "organizationLogo=$logo; Path=/";
    add_header Set-Cookie "organizationLogoDark=$logo; Path=/";
    return 200 "login-page";
  }
}`;
    const preamble = `pid /tmp/nginx.pid;
error_log stderr;
events {}
http {
  include /etc/nginx/mime.types;
  access_log off;
  client_body_temp_path /tmp/client-body;
  proxy_temp_path /tmp/proxy;
`;
    const command = `set -e
nginx -t -c /checks/nginx.conf
nginx -c /checks/nginx.conf
trap 'nginx -s quit -c /checks/nginx.conf' EXIT
wget -q -T 3 -O - http://127.0.0.1:81/login/oauth/authorize
test "$(wget -q -T 3 -O - --header='Cookie: private=value' --header='Authorization: Bearer private' http://127.0.0.1/healthz)" = ok
test "$(wget -q -T 3 -O - --header='Cookie: private=value' --header='Authorization: Bearer private' http://127.0.0.1/readyz)" = ok
`;
    for (const control of [false, true]) {
      const template = control
        ? source
            .replace(/^\s*proxy_buffer_size 16k;\n/m, "")
            .replace(/^\s*proxy_buffers 4 16k;\n/m, "")
        : source;
      const config = directory + (control ? "/default.conf" : "/bounded.conf");
      await writeFile(
        config,
        preamble +
          template.replaceAll("${BACKEND_URL}", "http://127.0.0.1:18082") +
          upstream +
          "\n}\n",
        { mode: 0o600 },
      );
      const result = spawnSync(
        "docker",
        [
          "run",
          "--rm",
          "--network",
          "none",
          "--read-only",
          "--user",
          `${process.getuid()}:${process.getgid()}`,
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--tmpfs",
          "/tmp:rw,mode=1777",
          "--tmpfs",
          "/var/cache/nginx:rw,mode=1777",
          "-v",
          config + ":/checks/nginx.conf:ro",
          "--entrypoint",
          "sh",
          image,
          "-c",
          command,
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      assert.ifError(result.error);
      if (control) {
        assert.notEqual(
          result.status,
          0,
          "default header buffer unexpectedly accepted the oversized response",
        );
        assert.match(result.stderr, /upstream sent too big header/);
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, "login-page");
      }
    }
  },
);
