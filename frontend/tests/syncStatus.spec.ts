import { expect, test } from "@playwright/test";
import { resetFixture } from "./fixture.ts";

test.use({ locale: "en-US", timezoneId: "America/Los_Angeles" });

test.beforeEach(async () => {
	await resetFixture({ readOnly: true });
});

for (const width of [1440, 390]) {
	test(`sidebar shows provider-neutral sync time at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		const providerRequests: string[] = [];
		page.on("request", (request) => {
			if (new URL(request.url()).pathname.startsWith("/v1/sync/"))
				providerRequests.push(request.url());
		});
		// The fixture has no sync runner. Supply only the generic status fields
		// while the model and projections still come from the real API.
		// A timestamp minutes old stays under the six-hour stale threshold.
		const lastSyncAt = new Date(Date.now() - 60_000).toISOString();
		await page.route("**/v1/status", async (route) => {
			const response = await route.fetch();
			await route.fulfill({
				response,
				json: {
					...(await response.json()),
					syncConfigured: true,
					lastSyncAt,
				},
			});
		});
		await page.goto("/");
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		// The loading shell also has a heading. Open the loaded sidebar, not its retiring placeholder.
		await expect(
			page.getByRole("region", { name: "Loading workspace" }),
		).toHaveCount(0);
		if (width < 600)
			await page.getByRole("button", { name: "Open navigation" }).click();
		const expected = `Last synced ${new Intl.DateTimeFormat("en-US", {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
			timeZone: "America/Los_Angeles",
		}).format(new Date(lastSyncAt))}`;
		const time = page.locator(`time[datetime="${lastSyncAt}"]`);
		await expect(time).toHaveText(expected);
		await expect(time).toBeInViewport();
		await expect(page.getByRole("button", { name: /sync/i })).toHaveCount(0);
		expect(providerRequests).toEqual([]);
	});
}

test("sidebar flags a stale sync and explains the fix", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const lastSyncAt = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
	await page.route("**/v1/status", async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			json: {
				...(await response.json()),
				syncConfigured: true,
				syncHost: "bridge.example",
				lastSyncAt,
			},
		});
	});
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(
		page.getByRole("region", { name: "Loading workspace" }),
	).toHaveCount(0);
	const warning = page.getByRole("button", { name: /sync stale/i });
	await expect(warning).toBeVisible();
	await expect(warning).toContainText("Last synced");
	await warning.click();
	const toast = page.getByRole("alert");
	await expect(toast).toHaveText(/Bank sync is stale\./);
	await toast.getByRole("button", { name: "Open bank sync" }).click();
	await expect(page.getByRole("tab", { name: "Bank sync" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.getByRole("heading", { name: "SimpleFIN" })).toBeVisible();
});

test("sidebar reports unconfigured sync from the real status endpoint", async ({
	page,
}) => {
	await page.goto("/");
	await expect(
		page.getByText("Sync not configured", { exact: true }),
	).toBeVisible();
});
