import { expect, test } from "@playwright/test";

// The demo command sets the clock to the pack's anchor date. Without it the
// safe-spending cycle follows the real calendar and the seeded rows drift out
// of the current statement window.
const anchor = process.env.DEMO_ANCHOR ?? new Date().toISOString().slice(0, 10);

test("seeded account demo", async ({ page }) => {
	await page.clock.setFixedTime(new Date(`${anchor}T12:00:00Z`));
	await page.goto("/outlook?detail=safe-spending&tab=cycle");
	await expect(
		page.getByRole("heading", { name: "Safe spending" }),
	).toBeVisible();
	if (process.env.DEMO_PACK === "safe-spending") {
		await expect(
			page.getByText("Cash after bills", { exact: true }),
		).toBeVisible();
		await expect(page.getByText("Spending pace")).toBeVisible();
		await expect(
			page.getByRole("separator", { name: "Cash limit" }),
		).toHaveCount(0);
		await expect(page.getByText("Reserve", { exact: true })).toBeVisible();
	}
	if (process.env.DEMO_PACK === "safe-spending-shortfall") {
		await expect(page.getByText("Retirement contribution")).toBeVisible();
		await expect(
			page.getByText("Outstanding bills", { exact: true }),
		).toBeVisible();
	}
	// The drawer keeps the per-cycle transaction list.
	await page.getByRole("button", { name: "This cycle transactions" }).click();
	await expect(
		page
			.getByRole("dialog", { name: "Safe spending" })
			.getByRole("heading", { name: "Spending this cycle" }),
	).toBeVisible();
	// Keep the headed browser open until the developer stops the command.
	const exitAfter = Number(process.env.DEMO_EXIT_AFTER_MS ?? 0);
	if (exitAfter > 0) await page.waitForTimeout(exitAfter);
	else await new Promise(() => {});
});
