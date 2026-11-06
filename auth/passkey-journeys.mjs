// Virtual authenticators verify browser continuation, not physical-device support.
import assert from "node:assert/strict";
import { expect } from "../frontend/node_modules/@playwright/test/index.mjs";

export async function passkeyJourneys(ctx, ownerBundle) {
  const context = await ctx.browser.newContext();
  try {
    // Copy cookies without sharing browser state. Clearing this context never
    // revokes or changes the main owner's captured-session logout regression.
    await context.addCookies(await ownerBundle.owner.cookies());
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await page.goto(`${ctx.issuer}/account`);
    await page.getByRole("button", { name: "Add a passkey", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Passkey added.");

    await context.clearCookies();
    await page.goto(`${ctx.origin}/v1/auth/login`);
    await page.getByRole("button", { name: "Sign in with a passkey", exact: true }).click();
    await page.waitForURL((url) => url.origin === ctx.origin && url.pathname === "/");
    const signedIn = await (await context.request.get(`${ctx.origin}/v1/auth/session`)).json();
    assert.equal(signedIn.authenticated, true);
    assert.equal(signedIn.user.subject, ctx.ownerSubject);

    const started = await context.request.post(`${ctx.origin}/v1/auth/device/start`, { data: {} });
    assert.equal(started.status(), 200);
    const device = await started.json();
    await context.clearCookies();
    await page.goto(`${ctx.issuer}/device`);
    await page.getByRole("button", { name: "Sign in with a passkey", exact: true }).click();
    await page.waitForURL((url) => url.origin === ctx.issuer && url.pathname === "/device");
    await page.getByLabel("Device code", { exact: true }).fill(device.userCode);
    await page.getByRole("button", { name: "Approve device", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/device");
    const polled = await context.request.post(`${ctx.origin}/v1/auth/device/poll`, {
      data: { deviceCode: device.deviceCode },
    });
    assert.equal(polled.status(), 200);
    const tokens = await polled.json();
    assert.equal(tokens.status, "complete");
    assert.equal(tokens.subject, ctx.ownerSubject);
    assert.ok(tokens.accessToken && tokens.refreshToken);
    console.log("e2e: passkey enrollment, OIDC continuation, and device approval PASS");
  } finally {
    await context.close();
  }
}
