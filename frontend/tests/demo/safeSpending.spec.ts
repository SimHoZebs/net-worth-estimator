import { expect, test } from "@playwright/test";

// The demo command sets the clock to the pack's anchor date so the dated
// allowance and its protected obligations read against the seeded evidence.
const anchor = process.env.DEMO_ANCHOR ?? new Date().toISOString().slice(0, 10);

test("seeded account demo", async ({ page }) => {
	await page.clock.setFixedTime(new Date(`${anchor}T12:00:00Z`));
	await page.goto("/outlook");
	await expect(
		page.getByRole("heading", { name: "Safe spending" }),
	).toBeVisible();
	if (process.env.DEMO_PACK === "safe-spending") {
		await expect(
			page.getByRole("region", { name: "Cycle budget" }),
		).toBeVisible();
		await expect(
			page.getByRole("region", { name: "Next cycle spending" }),
		).toBeVisible();
	}
	await page.getByRole("button", { name: /Protected obligations ·/ }).click();
	const drawer = page.getByRole("dialog", { name: "Safe spending" });
	await expect(
		drawer.getByRole("region", { name: "Cash checks" }),
	).toBeVisible();
	await expect(
		drawer.getByRole("region", { name: "Cash evidence" }),
	).toBeVisible();
	await expect(
		drawer.getByRole("region", { name: "Protected obligations" }),
	).toBeVisible();
	// Keep the headed browser open until the developer stops the command.
	const exitAfter = Number(process.env.DEMO_EXIT_AFTER_MS ?? 0);
	if (exitAfter > 0) await page.waitForTimeout(exitAfter);
	else await new Promise(() => {});
});
