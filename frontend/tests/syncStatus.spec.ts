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
		const lastSyncAt = "2026-10-18T02:30:00Z";
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
		if (width < 600)
			await page.getByRole("button", { name: "Open navigation" }).click();
		const time = page.locator(`time[datetime="${lastSyncAt}"]`);
		await expect(time).toHaveText("Last synced Oct 17, 7:30 PM");
		await expect(time).toBeInViewport();
		await expect(page.getByRole("button", { name: /sync/i })).toHaveCount(0);
		expect(providerRequests).toEqual([]);
	});
}

test("sidebar reports unconfigured sync from the real status endpoint", async ({
	page,
}) => {
	await page.goto("/");
	await expect(
		page.getByText("Sync not configured", { exact: true }),
	).toBeVisible();
});
