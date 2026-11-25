import { expect, test } from "./base.ts";

const CLOCK_START = new Date("2026-11-25T12:00:00.000Z");
const TOAST_TIMEOUT_MS = 5_000;
const BEFORE_DEADLINE_MS = TOAST_TIMEOUT_MS - 1_000;
const PAST_DEADLINE_MS = 1_000;
const EXIT_ANIMATION_MS = 600;

test("a non-action success dismisses after five seconds", async ({ page }) => {
	await page.clock.install({ time: CLOCK_START });
	await page.goto("/accounts/checking");

	const bar = page.locator("[data-account-action-bar]");
	await expect(bar).toBeVisible();
	const name = page.getByLabel("Account name");
	const save = bar.getByRole("button", { name: "Save changes" });
	await expect(save).toBeDisabled();
	await name.fill("Toast lifecycle checking");
	await expect(save).toBeEnabled();
	await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);

	const saved = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === "/v1/accounts/checking" &&
			response.request().method() === "PATCH",
	);
	await save.click();
	expect((await saved).status()).toBe(200);

	const toast = page
		.locator('[data-slot="toast"]')
		.filter({ hasText: "Changes saved." });
	await toast.waitFor({ state: "attached" });
	await page.clock.runFor(BEFORE_DEADLINE_MS);
	expect(await toast.isVisible()).toBe(true);

	await page.clock.runFor(PAST_DEADLINE_MS);
	expect(await toast.getAttribute("data-ending-style")).toBe("");
	await page.clock.runFor(EXIT_ANIMATION_MS);
	await expect(toast).toHaveCount(0);
});

test("an action error remains available beyond five seconds until closed", async ({
	page,
}) => {
	const staleSyncAt = new Date(
		CLOCK_START.getTime() - 24 * 60 * 60 * 1000,
	).toISOString();
	await page.route("**/v1/status", async (route) => {
		const response = await route.fetch();
		const body = (await response.json()) as Record<string, unknown>;
		await route.fulfill({
			response,
			json: {
				...body,
				syncConfigured: true,
				lastSyncAt: staleSyncAt,
			},
		});
	});
	await page.clock.install({ time: CLOCK_START });
	await page.goto("/accounts");

	const staleSync = page
		.locator('[data-slot="sidebar-footer"]')
		.getByRole("button", { name: /Last synced .*Sync stale/ });
	await expect(staleSync).toBeVisible();
	await staleSync.click();

	const toast = page
		.locator('[data-slot="toast"]')
		.filter({ hasText: "Bank sync is stale." });
	await expect(toast).toBeVisible();
	const action = toast.locator('[data-slot="toast-action"]');
	await expect(action).toHaveText("Open bank sync");
	await expect(action).toBeVisible();

	await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
	await page.clock.runFor(TOAST_TIMEOUT_MS + PAST_DEADLINE_MS);
	await expect(toast).toBeVisible();
	await expect(action).toBeEnabled();

	await page.clock.resume();
	await toast.locator('[data-slot="toast-close"]').click();
	await expect(toast).toHaveCount(0);
});
