import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { BackendCheckpoint } from "../src/api/contracts.ts";
import { FIXTURE_API, resetFixture } from "./fixture.ts";

test.beforeEach(async () => resetFixture());

test("Outlook compares the latest balance with the first synced balance", async ({
	page,
	request,
}) => {
	const response = await request.post(`${FIXTURE_API}/v1/checkpoints`, {
		data: {
			AccountId: "checking",
			observedAt: Date.parse("2026-02-01T23:59:59Z") / 1000,
			Balance: 6200,
		} satisfies BackendCheckpoint,
	});
	expect(response.ok()).toBe(true);
	// The fixture imports user-owned observations. Replace only their source
	// metadata to represent bank sync. Balances and engine totals remain real.
	await page.route("**/v1/checkpoints", async (route) => {
		const response = await route.fetch();
		const body = await response.json();
		await route.fulfill({
			response,
			json: {
				...body,
				checkpoints: body.checkpoints.map(
					(checkpoint: Record<string, unknown>) => ({
						...checkpoint,
						source: "simplefin",
					}),
				),
			},
		});
	});
	await page.goto("/");
	const chart = page.getByRole("region", {
		name: "Net worth over the trailing 30 days",
	});
	await expect(chart.getByText("+$2,000 (+0.6%)")).toBeVisible();
	await expect(
		chart.getByText("since first sync · Jan 31, 2026"),
	).toBeVisible();
	await expect(chart.getByText("As of Feb 1, 2026")).toBeVisible();
	await expect(
		chart.getByText("$363,200", { exact: true }).first(),
	).toBeVisible();
	await page.getByRole("button", { name: "90 days" }).click();
	await expect(page.getByText("+$2,000 (+0.6%)")).toBeVisible();
	await page.getByRole("slider", { name: "Inspect net worth date" }).focus();
	await page.keyboard.press("Home");
	await expect(page.getByText("+$2,000 (+0.6%)")).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByText("+$2,000 (+0.6%)")).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
	const accessibility = await new AxeBuilder({ page })
		.include('section[aria-label="Net worth over the trailing 90 days"]')
		.analyze();
	expect(accessibility.violations).toEqual([]);
});

test("manual observations do not claim a bank-sync comparison", async ({
	page,
}) => {
	await page.goto("/");
	await expect(
		page.getByRole("slider", { name: "Inspect net worth date" }),
	).toBeVisible();
	await expect(page.getByText(/since first sync/)).toHaveCount(0);
});
