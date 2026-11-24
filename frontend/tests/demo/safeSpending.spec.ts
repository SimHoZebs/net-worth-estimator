import { expect, test } from "@playwright/test";

// The demo command sets the clock to the pack's anchor date so the payment
// window and its recorded activity read against the seeded evidence.
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
	await page.getByRole("button", { name: /^Transactions/ }).click();
	const drawer = page.getByRole("dialog", { name: "Safe spending" });
	await expect(
		drawer.getByRole("heading", { name: "Spending this cycle" }),
	).toBeVisible();
	await expect(
		drawer.getByRole("tab", { name: /Transactions/ }),
	).toHaveAttribute("aria-selected", "true");
	// Keep the headed browser open until the developer stops the command.
	const exitAfter = Number(process.env.DEMO_EXIT_AFTER_MS ?? 0);
	if (exitAfter > 0) await page.waitForTimeout(exitAfter);
	else await new Promise(() => {});
});
