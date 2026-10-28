import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

async function smoke(t, finalEvent = "result", readiness = 200) {
  let projection;
  const server = createServer(async (request, response) => {
    const send = (status, value) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(typeof value === "string" ? value : JSON.stringify(value));
    };
    if (request.url === "/healthz") return send(200, "ok");
    if (request.url === "/readyz") return send(readiness, readiness === 200 ? "ok" : "not ready");
    if (request.url === "/") return send(200, '<div id="root"></div>');
    if (request.url === "/settings") return send(404, "missing");
    if (request.url === "/v1/auth/session")
      return send(200, {
        enabled: true,
        allowed: true,
        resource: { id: "plans/sample", kind: "sample" },
      });
    if (request.headers["waypoint-resource"] !== "plans/sample")
      return send(409, "resource required");
    if (request.headers.origin === "http://unlisted.example") return send(403, "origin rejected");
    if (request.url === "/v1/status") return send(200, { readOnly: true });
    if (request.url === "/v1/financial-model")
      return send(200, {
        document: { checkpoints: [{ Date: "2026-10-21" }, { Date: "2026-10-22" }] },
      });
    if (request.url === "/v1/projections/stochastic") {
      let body = "";
      for await (const chunk of request) body += chunk;
      projection = JSON.parse(body);
      if (projection.settings.fallbackProjectionStartDate !== "2026-10-22")
        return send(400, "projection start required");
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      return response.end(`event: ${finalEvent}\ndata: {}\n\n`);
    }
    send(404, "unexpected route");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const child = spawn("sh", [fileURLToPath(new URL("./smoke-compose.sh", import.meta.url))], {
    env: { ...process.env, FRONTEND_URL: origin, BACKEND_URL: "" },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { status, stderr, projection };
}

test("guest smoke asserts its resource, supplies a valid start, and accepts a final-only cache hit", async (t) => {
  const result = await smoke(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.projection.config, { runCount: 1, seed: 42 });
  assert.equal(result.projection.settings.horizonYears, 1);
});

test("guest smoke fails on an SSE error instead of accepting incomplete progress", async (t) => {
  const result = await smoke(t, "error");
  assert.equal(result.status, 1);
});

test("guest smoke fails when the public API is not ready", async (t) => {
  const result = await smoke(t, "result", 503);
  assert.equal(result.status, 1);
});
