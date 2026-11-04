import { expect, test } from "@playwright/test";

// The demo command sets the clock to the pack's anchor date. Without it the
// safe-spending cycle follows the real calendar and the seeded rows drift out
// of the current statement window.
const anchor = process.env.DEMO_ANCHOR ?? new Date().toISOString().slice(0, 10);

test("seeded account demo", async ({ page }) => {
	await page.clock.setFixedTime(new Date(`${anchor}T12:00:00Z`));
	await page.goto("/#outlook/safe-spending-detail/cycle");
	await expect(
		page.getByRole("heading", { name: "Safe card spending" }).first(),
	).toBeVisible();
	if (process.env.DEMO_PACK === "safe-spending") {
		const drawer = page.getByRole("dialog", { name: "Safe card spending" });
		await expect(drawer.getByText("Card spending pace")).toBeVisible();
		await expect(
			drawer.getByRole("separator", { name: "Card spending limit" }),
		).toBeVisible();
		await expect(
			drawer.getByText("Protected reserve starts", { exact: true }),
		).toBeVisible();
	}
	if (process.env.DEMO_PACK === "safe-spending-shortfall") {
		const drawer = page.getByRole("dialog", { name: "Safe card spending" });
		await expect(drawer.getByText("Retirement contribution")).toBeVisible();
		await expect(drawer.getByText("Unfulfilled")).toBeVisible();
	}
	// Keep the headed browser open until the developer stops the command.
	const exitAfter = Number(process.env.DEMO_EXIT_AFTER_MS ?? 0);
	if (exitAfter > 0) await page.waitForTimeout(exitAfter);
	else await new Promise(() => {});
});
