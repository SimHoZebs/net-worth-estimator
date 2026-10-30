import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("installed extension connects, captures, picks, persists drafts, and retries one save", async () => {
  const requests = [];
  let approved = false;
  let saves = 0;
  let saved;
  let base;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, headers: request.headers, body });
    const json = (value, status = 200) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    switch (request.url) {
      case "/product":
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(
          '<!doctype html><html lang="en"><head><title>Workshop desk</title><script type="application/ld+json">{"@type":"Product","name":"Workshop desk","sku":"oak","offers":{"@type":"Offer","price":"129.95","priceCurrency":"USD"}}</script></head><body><main><h1 tabindex="0">Workshop desk</h1><a id="price" href="/accidental-order">USD 149.95</a><form><input value="NEVER_CAPTURE_PRIVATE"><p>PRIVATE_FORM_TEXT</p></form><p hidden>HIDDEN_PRIVATE_TEXT</p></main></body></html>',
        );
        return;
      case "/approve":
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(
          "<!doctype html><title>Approve Waypoint</title><button onclick=\"fetch('/approved', {method: 'POST'}).then(() => document.body.textContent = 'Approved')\">Approve extension</button>",
        );
        return;
      case "/approved":
        approved = true;
        json({});
        return;
      case "/v1/auth/device/start":
        json({
          verificationUri: base + "/approve",
          deviceCode: "fixture-device",
          userCode: "CODE",
          expiresIn: 600,
          interval: 1,
        });
        return;
      case "/v1/auth/device/poll":
        json(
          approved
            ? {
                status: "complete",
                accessToken: "fixture-access",
                refreshToken: "fixture-refresh",
                expiresIn: 3600,
              }
            : { status: "pending" },
        );
        return;
      case "/v1/auth/device/refresh":
        json({
          status: "complete",
          accessToken: "fixture-access",
          refreshToken: "fixture-refresh",
          expiresIn: 3600,
        });
        return;
      case "/ai/v1/chat/completions": {
        expect(request.headers.authorization).toBe("Bearer fixture-ai-key");
        expect(body).not.toContain("PRIVATE");
        expect(body).not.toContain("Everyday cash");
        json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: "AI desk",
                  priceText: "USD 139.95",
                  currency: "USD",
                }),
              },
            },
          ],
        });
        return;
      }
      case "/v1/auth/session":
        json({
          authenticated: true,
          user: { name: "Test planner", subject: "test" },
          resource: { id: "users/test", permissions: ["user:read", "user:write"] },
        });
        return;
      case "/v1/status":
        json({ readOnly: false });
        return;
      case "/v1/financial-model":
        expect(request.headers.origin).toBeUndefined();
        expect(request.headers["sec-fetch-site"]).toBe("none");
        json({
          model: {
            accounts: [
              { id: "cash", name: "Everyday cash", kind: "cash", enabled: true },
              { id: "card", name: "Credit card", kind: "debt", enabled: true },
            ],
            postings: [],
            plannedPurchases: saved ? [saved] : [],
          },
        });
        return;
      case "/v1/planned-purchases": {
        expect(request.headers.authorization).toBe("Bearer fixture-access");
        expect(request.headers["waypoint-resource"]).toBe("users/test");
        expect(request.headers.cookie).toBeUndefined();
        expect(request.headers.origin).toMatch(/^chrome-extension:\/\/[a-p]{32}$/);
        expect(request.headers["sec-fetch-site"]).toBe("none");
        const payload = JSON.parse(body);
        if (saved) expect(payload).toEqual(saved);
        else {
          saved = payload;
          saves++;
          json({ detail: "The purchase committed, but the response failed." }, 503);
          return;
        }
        json({ detail: "ID already exists" }, 409);
        return;
      }
      default:
        json({ detail: "Not found" }, 404);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const temp = await mkdtemp("/tmp/opencode/waypoint-extension-test-");
  const extension = join(temp, "extension");
  await mkdir(extension);
  const root = fileURLToPath(new URL("../", import.meta.url));
  for (const name of ["manifest.json", "panel.html", "panel.css", "src"])
    await cp(join(root, name), join(extension, name), { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, "manifest.json"), "utf8"));
  expect(manifest.host_permissions).toBeUndefined();
  // Only this disposable browser fixture pre-grants its own ephemeral origin.
  manifest.host_permissions = [base + "/*"];
  await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
  let context;
  try {
    context = await chromium.launchPersistentContext(join(temp, "profile"), {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const merchant = await context.newPage();
    await merchant.goto(base + "/product");
    const popupEvent = context.waitForEvent("page");
    await worker.evaluate(() =>
      chrome.windows.create({
        url: chrome.runtime.getURL("panel.html"),
        type: "popup",
        width: 420,
        height: 900,
      }),
    );
    const panel = await popupEvent;
    const errors = [];
    panel.on("pageerror", (error) => errors.push(error.message));
    await expect(panel.getByRole("heading", { level: 1 })).toContainText("Plan it.");
    await panel.getByLabel("Waypoint app URL").fill(base);
    await panel.getByLabel("API base URL").fill(base + "/ai/v1");
    await panel.getByLabel("Model ID").fill("fixture-model");
    await panel.getByLabel("API key", { exact: true }).fill("fixture-ai-key");
    await panel.getByRole("button", { name: "Save settings" }).click();
    await expect(panel.getByRole("button", { name: "Save settings" })).toBeEnabled();
    await expect(panel.locator("#error")).toBeHidden();
    const approvalEvent = context
      .waitForEvent("page", { timeout: 10000 })
      .catch((failure) => failure);
    await panel.getByRole("button", { name: "Connect", exact: true }).click();
    const approval = await approvalEvent;
    if (approval instanceof Error)
      throw new Error(
        `Approval did not open. UI: ${await panel.locator("body").innerText()}. Requests: ${requests.map((request) => request.path).join(", ")}`,
      );
    await approval.getByRole("button", { name: "Approve extension" }).click();
    await expect(approval.getByText("Approved")).toBeVisible();
    await approval.close();
    await expect(panel.locator("#identity")).toHaveText("Connected · Test planner", {
      timeout: 15000,
    });
    await expect(panel.getByLabel("Funding account")).toContainText("Everyday cash");
    await panel.getByRole("button", { name: "Read this page" }).click();
    await expect(panel.getByLabel("Purchase name", { exact: false }).first()).toHaveValue(
      "Workshop desk",
    );
    await expect(panel.locator("#cost")).toHaveValue("129.95");
    expect(requests.some((request) => request.path === "/ai/v1/chat/completions")).toBe(false);
    await panel.getByRole("button", { name: "AI autofill" }).click();
    await expect(panel.locator("#name")).toHaveValue("AI desk");
    await expect(panel.locator("#cost")).toHaveValue("139.95");
    await panel.getByRole("button", { name: "Pick cost from page" }).click();
    await merchant.locator("#price").click();
    await expect(merchant).toHaveURL(base + "/product");
    await expect(panel.locator("#cost")).toHaveValue("149.95");
    await panel.locator("#name").fill("My desk");
    await panel.locator("#fromId").selectOption("cash");
    await panel.reload();
    await expect(panel.locator("#name")).toHaveValue("My desk");
    await expect(panel.locator("#cost")).toHaveValue("149.95");
    await panel.getByRole("button", { name: "Add planned purchase" }).click();
    await expect(panel.getByRole("button", { name: "Retry the same save" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Retry the same save" })).toBeEnabled();
    await panel.reload();
    await panel.getByRole("button", { name: "Retry the same save" }).click();
    await expect(
      panel.getByRole("heading", { name: "Added to your financial model" }),
    ).toBeVisible();
    expect(saves).toBe(1);
    expect(saved.name).toBe("My desk");
    expect(saved.fundingAccountId).toBe("cash");
    expect(saved.cost).toBe(149.95);
    expect(saved.priority).toBe(0);
    expect(saved.enabled).toBe(true);
    expect(saved.earliestDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(saved)).not.toContain("sourceUrl");
    const captureState = await worker.evaluate(() => chrome.storage.local.get("captureState"));
    expect(captureState.captureState.draft.sourceUrl).toBe(base + "/product");
    expect(captureState.captureState.draft.priceMethod).toBe("picker");
    expect(requests.filter((request) => request.path === "/v1/planned-purchases")).toHaveLength(2);
    expect(requests.some((request) => request.path.startsWith("/v1/postings"))).toBe(false);
    expect(requests.some((request) => request.path.startsWith("/v1/purchase-captures"))).toBe(
      false,
    );
    const stored = await worker.evaluate(() => chrome.storage.session.get("snapshot"));
    expect(JSON.stringify(stored)).not.toContain("PRIVATE");
    expect(requests.some((request) => request.path === "/accidental-order")).toBe(false);
    expect(errors).toEqual([]);
    const metrics = await panel.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      labels: [...document.querySelectorAll("input,select")].every(
        (input) => document.querySelector(`label[for="${input.id}"]`) || input.closest("label"),
      ),
    }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.width);
    expect(metrics.labels).toBe(true);
    const localSecrets = await worker.evaluate(() => chrome.storage.local.get(null));
    expect(JSON.stringify(localSecrets)).not.toContain("fixture-ai-key");
    const contentAccess = await worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.url === url);
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () =>
          Promise.all(
            ["local", "session"].map(async (area) => {
              try {
                await chrome.storage[area].get(null);
                return "accessible";
              } catch {
                return "denied";
              }
            }),
          ),
      });
      return result.result;
    }, base + "/product");
    expect(contentAccess).toEqual(["denied", "denied"]);
    await panel.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(panel.locator("#identity")).toHaveText("Not connected");
    const local = await worker.evaluate(() => chrome.storage.local.get("connection"));
    expect(local.connection).toBeUndefined();
  } finally {
    await context?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});
