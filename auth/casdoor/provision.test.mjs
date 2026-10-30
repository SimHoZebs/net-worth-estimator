import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, stat, unlink, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { casdoorSession, provision, writeBootstrap } from "./provision.mjs";
import { generate, settingsFromEnv } from "./generate.mjs";

async function withServer(handler, run) {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    response.setHeader("Content-Type", "application/json");
    await handler(
      request,
      response,
      body
        ? request.headers["content-type"] === "application/x-www-form-urlencoded"
          ? Object.fromEntries(new URLSearchParams(body))
          : JSON.parse(body)
        : undefined,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("retains and rotates cookies without sending a GET body", async () => {
  let calls = 0;
  await withServer(
    (request, response, body) => {
      calls++;
      if (calls === 1) {
        assert.equal(request.method, "POST");
        assert.deepEqual(body, { test: true });
        response.setHeader("Set-Cookie", ["session=first; HttpOnly", "other=value; Path=/"]);
      } else if (calls === 2) {
        assert.equal(request.method, "GET");
        assert.equal(body, undefined);
        assert.equal(request.headers.cookie, "session=first; other=value");
        response.setHeader("Set-Cookie", "session=second; HttpOnly");
      } else {
        assert.equal(request.headers.cookie, "session=second; other=value");
      }
      response.end('{"status":"ok"}');
    },
    async (url) => {
      const request = casdoorSession(url);
      await request("/login", { method: "POST", body: { test: true } });
      await request("/account");
      await request("/account");
    },
  );
  assert.equal(calls, 3);
});

test("does not expose upstream response bodies or query secrets in errors", async () => {
  await withServer(
    (request, response) => {
      response.end('{"status":"error","msg":"sensitive upstream detail"}');
    },
    async (url) => {
      await assert.rejects(
        () => casdoorSession(url)("/failure?secret=private"),
        (error) => {
          assert.match(error.message, /GET \/failure \(200\)/);
          assert.doesNotMatch(error.message, /sensitive|private/);
          return true;
        },
      );
    },
  );
});

test("sends Casdoor password-reset form fields without JSON encoding", async () => {
  await withServer(
    (request, response, body) => {
      assert.equal(request.method, "POST");
      assert.equal(request.headers["content-type"], "application/x-www-form-urlencoded");
      assert.deepEqual(body, {
        userOwner: "waypoint",
        userName: "household",
        oldPassword: "",
        newPassword: "replacement",
      });
      response.end('{"status":"ok"}');
    },
    (url) =>
      casdoorSession(url)("/api/set-password", {
        method: "POST",
        form: {
          userOwner: "waypoint",
          userName: "household",
          oldPassword: "",
          newPassword: "replacement",
        },
      }),
  );
});

test("discovers the generated ordinary subject and logs the bootstrap session out", async () => {
  const logins = [];
  let name;
  let logouts = 0;
  const expectedAuth = `Basic ${Buffer.from("client:test-secret").toString("base64")}`;
  await withServer(
    (request, response, body) => {
      if (request.url === "/api/login") {
        name = body.username;
        logins.push(name);
        assert.equal(body.organization, "waypoint");
        assert.equal(body.application, "waypoint");
        response.setHeader("Set-Cookie", "session=owner-session; HttpOnly");
        response.end('{"status":"ok"}');
      } else if (request.url === "/api/get-account") {
        assert.ok(
          (request.headers.cookie || "").includes("session=owner-session"),
          "Owner lookup keeps its login session",
        );
        response.end(
          JSON.stringify({
            status: "ok",
            sub: "provider-generated-subject",
            data: { id: "provider-generated-subject", name, owner: "waypoint", isAdmin: false },
          }),
        );
      } else if (request.url.startsWith("/api/get-user")) {
        assert.equal(request.url, "/api/get-user?id=waypoint%2Fguest");
        assert.equal(
          request.headers.authorization,
          expectedAuth,
          "Guest discovery uses app BasicAuth, not the owner session",
        );
        assert.equal(
          request.headers.cookie,
          undefined,
          "Guest discovery must not carry the owner session cookie",
        );
        response.end(
          JSON.stringify({
            status: "ok",
            data: {
              id: "provider-generated-guest",
              name: "guest",
              owner: "waypoint",
              isAdmin: false,
              isForbidden: false,
              isDeleted: false,
            },
          }),
        );
      } else if (request.url === "/api/logout") {
        logouts++;
        response.end('{"status":"ok"}');
      } else {
        assert.fail(`Unexpected request: ${request.url}`);
      }
    },
    async (publicUrl) => {
      const metadata = await provision({
        publicUrl,
        username: "household",
        guestName: "guest",
        password: "test",
        appUrl: "https://app.example.test",
        clientId: "client",
        clientSecret: "test-secret",
      });
      assert.equal(metadata.subject, "provider-generated-subject");
      assert.equal(metadata.guest_subject, "provider-generated-guest");
      assert.equal(metadata.username, "household");
      assert.equal(metadata.redirect_uri, "https://app.example.test/v1/auth/callback");
      assert.equal(Object.hasOwn(metadata, "password"), false);
    },
  );
  assert.deepEqual(logins, ["household"]);
  assert.equal(logouts, 1);
});

test("rejects inconsistent subject claims and still ends its session", async () => {
  let loggedOut = false;
  await withServer(
    (request, response) => {
      if (request.url === "/api/get-account") {
        response.end(
          JSON.stringify({
            status: "ok",
            sub: "different-subject",
            data: { id: "random-id", name: "household", owner: "waypoint", isAdmin: false },
          }),
        );
      } else {
        if (request.url === "/api/logout") loggedOut = true;
        response.end('{"status":"ok"}');
      }
    },
    (publicUrl) =>
      assert.rejects(
        () => provision({ publicUrl, username: "household", password: "test" }),
        /inconsistent subject/,
      ),
  );
  assert.equal(loggedOut, true);
});

test("rejects a missing or unusable provisioned guest and still ends its session", async () => {
  const guests = [
    null,
    { id: "", name: "guest", owner: "waypoint" },
    { id: "guest-id", name: "someone-else", owner: "waypoint" },
    { id: "guest-id", name: "guest", owner: "built-in" },
    { id: "guest-id", name: "guest", owner: "waypoint", isAdmin: true },
    { id: "guest-id", name: "guest", owner: "waypoint", isForbidden: true },
    { id: "guest-id", name: "guest", owner: "waypoint", isDeleted: true },
    { id: "owner-id", name: "guest", owner: "waypoint" },
  ];
  for (const guest of guests) {
    let loggedOut = false;
    await withServer(
      (request, response) => {
        if (request.url === "/api/get-account") {
          response.end(
            JSON.stringify({
              status: "ok",
              sub: "owner-id",
              data: { id: "owner-id", name: "household", owner: "waypoint", isAdmin: false },
            }),
          );
        } else if (request.url.startsWith("/api/get-user")) {
          response.end(JSON.stringify({ status: "ok", data: guest }));
        } else {
          if (request.url === "/api/logout") loggedOut = true;
          response.end('{"status":"ok"}');
        }
      },
      (publicUrl) =>
        assert.rejects(
          () =>
            provision({
              publicUrl,
              username: "household",
              guestName: "guest",
              clientId: "client",
              clientSecret: "test-secret",
            }),
          /guest/,
        ),
    );
    assert.equal(loggedOut, true);
  }
});

test("rejects guest discovery without application credentials and still ends its session", async () => {
  let loggedOut = false;
  let guestLookups = 0;
  await withServer(
    (request, response) => {
      if (request.url === "/api/get-account") {
        response.end(
          JSON.stringify({
            status: "ok",
            sub: "owner-id",
            data: { id: "owner-id", name: "household", owner: "waypoint", isAdmin: false },
          }),
        );
      } else if (request.url.startsWith("/api/get-user")) {
        guestLookups++;
        response.end(JSON.stringify({ status: "ok", data: null }));
      } else {
        if (request.url === "/api/logout") loggedOut = true;
        response.end('{"status":"ok"}');
      }
    },
    (publicUrl) =>
      assert.rejects(
        () => provision({ publicUrl, username: "household", guestName: "guest" }),
        /Application credentials are required/,
      ),
  );
  assert.equal(guestLookups, 0);
  assert.equal(loggedOut, true);
});

test("records private bootstrap metadata only after sealing future imports, without overwriting it", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "casdoor-bootstrap-"));
  try {
    await withServer(
      (request, response) => {
        if (request.url === "/api/get-account") {
          response.end(
            JSON.stringify({
              status: "ok",
              sub: "generated-id",
              data: {
                id: "generated-id",
                name: "household",
                owner: "waypoint",
                isAdmin: false,
              },
            }),
          );
        } else if (request.url.startsWith("/api/get-user")) {
          response.end(
            JSON.stringify({
              status: "ok",
              data: {
                id: "generated-guest-id",
                name: "guest",
                owner: "waypoint",
                isAdmin: false,
                isForbidden: false,
                isDeleted: false,
              },
            }),
          );
        } else {
          response.end(JSON.stringify({ status: "ok" }));
        }
      },
      async (publicUrl) => {
        const settings = settingsFromEnv({
          CASDOOR_PUBLIC_URL: publicUrl,
          APP_PUBLIC_URL: "http://localhost:8080",
          AUTH_CLIENT_ID: "test",
          AUTH_CLIENT_SECRET: "client-secret-for-test",
          CASDOOR_ADMIN_PASSWORD: "admin-password-for-test",
          CASDOOR_USER_NAME: "household",
          CASDOOR_USER_PASSWORD: "user-password-for-test",
        });
        await generate(settings, dir);
        const metadata = await writeBootstrap(settings, dir);
        const config = await readFile(resolve(dir, "conf/app.conf"), "utf8");
        assert.match(config, /^initDataNewOnly = true$/m);
        assert.match(config, /^initDataMerge = false$/m);
        assert.equal((await stat(resolve(dir, "conf/app.conf"))).mode & 0o777, 0o600);
        assert.equal((await stat(resolve(dir, "bootstrap.json"))).mode & 0o777, 0o600);
        assert.deepEqual(
          JSON.parse(await readFile(resolve(dir, "bootstrap.json"), "utf8")),
          metadata,
        );
        await assert.rejects(() => writeBootstrap(settings, dir), /already exists/);
        assert.equal(await readFile(resolve(dir, "conf/app.conf"), "utf8"), config);
        // An interrupted run after sealing can complete without another import.
        await unlink(resolve(dir, "bootstrap.json"));
        assert.deepEqual(await writeBootstrap(settings, dir), metadata);
        await unlink(resolve(dir, "bootstrap.json"));
        await writeFile(
          resolve(dir, "conf/app.conf"),
          config.replace("initDataMerge = false", "initDataMerge = unknown"),
        );
        await assert.rejects(
          () => writeBootstrap(settings, dir),
          /unknown Casdoor import settings/,
        );
        await assert.rejects(() => stat(resolve(dir, "bootstrap.json")), { code: "ENOENT" });
      },
    );
  } finally {
    for (const file of ["conf/app.conf", "conf/init_data.json", "bootstrap.json"]) {
      await unlink(resolve(dir, file)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    for (const part of ["conf", "db", "sessions", ""]) await rmdir(resolve(dir, part));
  }
});
