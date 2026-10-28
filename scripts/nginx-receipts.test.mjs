import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import test from "node:test";

const image = process.env.NGINX_TEST_IMAGE;

test("receipt upload limit preserves API proxy inheritance and other route limits", { skip: !image }, async () => {
  const directory = await mkdtemp("/tmp/opencode/nginx-receipt-upload-");
  const source = await readFile(new URL("../frontend/nginx.conf.template", import.meta.url), "utf8");
  const config = directory + "/nginx.conf";
  await writeFile(config, `pid /tmp/nginx.pid;
error_log stderr;
events {}
http {
  include /etc/nginx/mime.types;
  access_log off;
  client_body_temp_path /tmp/client-body;
  proxy_temp_path /tmp/proxy;
${source.replaceAll("${BACKEND_URL}", "http://127.0.0.1:18082")}
  server {
    listen 18082;
    client_max_body_size 16m;
    location / { return 200 "proxied $request_uri $request_method"; }
  }
}
`, { mode: 0o600 });
  const command = `set -e
nginx -t -c /checks/nginx.conf
nginx -c /checks/nginx.conf
trap 'nginx -s quit -c /checks/nginx.conf' EXIT
yes x | head -c 2097152 > /tmp/upload
wget -q -T 5 -O - --post-file=/tmp/upload http://127.0.0.1/v1/receipts
if wget -T 5 -O /dev/null --post-file=/tmp/upload http://127.0.0.1/v1/accounts 2>/tmp/other-error; then exit 1; fi
grep -q 413 /tmp/other-error
yes x | head -c 12582912 > /tmp/upload
if wget -T 5 -O /dev/null --post-file=/tmp/upload http://127.0.0.1/v1/receipts 2>/tmp/large-error; then exit 1; fi
grep -q 413 /tmp/large-error
`;
  const result = spawnSync("docker", [
    "run", "--rm", "--network", "none", "--read-only",
    "--user", `${process.getuid()}:${process.getgid()}`, "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,mode=1777",
    "--tmpfs", "/var/cache/nginx:rw,mode=1777", "-v", config + ":/checks/nginx.conf:ro",
    "--entrypoint", "sh", image, "-c", command,
  ], { encoding: "utf8", timeout: 20000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "proxied /v1/receipts POST");
});
