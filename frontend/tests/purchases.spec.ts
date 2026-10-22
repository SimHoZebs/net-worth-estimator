import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type { FinancialModelDocument } from "../src/api/contracts.ts";
import { FIXTURE_API, readTemporaryVersion, resetFixture } from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture();
});

async function openPurchases(page: Page) {
	await page.goto("/#purchases");
	await expect(
		page.getByRole("heading", { level: 1, name: "Plan your purchases" }),
	).toBeVisible();
}

async function addPurchase(page: Page, name: string, cost: string) {
	await page.getByRole("button", { name: "Add purchase" }).click();
	const dialog = page.getByRole("dialog", { name: "Add purchase" });
	await dialog.getByLabel("Purchase name").fill(name);
	await dialog.getByLabel("Cost (USD)").fill(cost);
	await dialog.getByLabel("Funding account").selectOption("checking");
	await dialog.getByRole("button", { name: "Apply unsaved changes" }).click();
	await expect(dialog).not.toBeVisible();
}

test("planned purchases has a navigation entry, direct route, and browser history", async ({
	page,
}) => {
	await page.goto("/#transactions");
	await expect(page.getByRole("tab", { name: /Wish list/ })).toHaveCount(0);
	await page
		.getByRole("link", { name: "Planned purchases", exact: true })
		.click();
	await expect(page).toHaveURL(/#purchases$/);
	await expect(
		page.getByRole("link", { name: "Planned purchases", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await expect(
		page.getByRole("heading", { level: 1, name: "Plan your purchases" }),
	).toBeFocused();
	await expect(page).toHaveTitle("Planned purchases · Waypoint");
	await page.getByRole("link", { name: "Transactions", exact: true }).click();
	await expect(page).toHaveURL(/#transactions$/);
	await page.goBack();
	await expect(page).toHaveURL(/#purchases$/);
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Add purchase" }),
	).toBeVisible();
});

test("purchase priorities persist and purchases protect all established payments", async ({
	page,
	request,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await openPurchases(page);
	await addPurchase(page, "Laptop", "500");
	await addPurchase(page, "Chair", "150");
	const queue = page.getByRole("list", { name: "Purchase priorities" });
	await expect(queue.locator("li").first()).toContainText("Laptop");
	await page.getByRole("button", { name: "Move Chair up" }).click();
	await expect(queue.locator("li").first()).toContainText("Chair");
	await expect(
		page.getByRole("status").filter({ hasText: "Chair is now priority 1" }),
	).toHaveText("Chair is now priority 1.");
	await expect(
		page.getByRole("list", { name: "Purchase dates" }).locator("time"),
	).toHaveCount(2);
	const temporary = await readTemporaryVersion(page);
	expect(
		temporary.movements.find((item: { name: string }) => item.name === "Chair")
			.purchasePriority,
	).toBe(0);
	await page.reload();
	await expect(queue.locator("li").first()).toContainText("Chair");
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect(page.getByText("Plan saved on the server.")).toBeVisible();
	const response = await request.get(`${FIXTURE_API}/v1/financial-model`);
	const { document } = (await response.json()) as {
		document: FinancialModelDocument;
	};
	const chair = document.postings.find((item) => item.name === "Chair")!;
	expect(chair.purchase).toEqual({ priority: 0 });
	const projection = await request.post(
		`${FIXTURE_API}/v1/projections/deterministic`,
		{
			data: {
				document,
				settings: {
					fallbackProjectionStartDate: "2026-01-31",
					horizonYears: 20,
					evaluations: {
						...document.evaluations,
						plannedPurchases: [
							{
								instanceId: "purchases",
								name: "Planned purchases",
								enabled: true,
								config: {},
							},
						],
					},
				},
			},
		},
	);
	expect(projection.ok()).toBe(true);
	const { result } = await projection.json();
	const purchasesInBaseline = result.movementEvents.filter(
		(event: { origin: { postingId: string } }) =>
			document.postings.some(
				(posting) => posting.purchase && posting.id === event.origin.postingId,
			),
	);
	expect(purchasesInBaseline).toHaveLength(0);
	const analysis = result.evaluations.plannedPurchases[0].deterministic;
	expect(analysis.allFunded).toBe(true);
	expect(analysis.purchases).toHaveLength(2);
	expect(
		analysis.purchases.every((item: { date: string | null }) => item.date),
	).toBe(true);
	const withoutPurchases = await request.post(
		`${FIXTURE_API}/v1/projections/deterministic`,
		{
			data: {
				document: {
					...document,
					postings: document.postings.filter((item) => !item.purchase),
				},
				settings: {
					fallbackProjectionStartDate: "2026-01-31",
					horizonYears: 20,
					evaluations: document.evaluations,
				},
			},
		},
	);
	expect(withoutPurchases.ok()).toBe(true);
	const baseline = (await withoutPurchases.json()).result;
	expect(result.timeline).toEqual(baseline.timeline);
	expect(result.totals).toEqual(baseline.totals);
	expect(result.summary).toEqual(baseline.summary);
	expect(result.accountSummaries).toEqual(baseline.accountSummaries);
	expect(result.movementEvents).toEqual(baseline.movementEvents);
	expect(result.evaluations.financialIndependence).toEqual(
		baseline.evaluations.financialIndependence,
	);
	await page.getByRole("button", { name: "Edit Chair" }).click();
	const editor = page.getByRole("dialog", { name: "Edit purchase" });
	await editor.getByLabel("Cost (USD)").fill("200");
	await editor.getByRole("button", { name: "Apply unsaved changes" }).click();
	await expect(queue.locator("li").first()).toContainText("$200");
	await page.getByRole("button", { name: "Remove Chair" }).click();
	await page
		.getByRole("button", { name: "Remove from unsaved changes" })
		.click();
	await expect(queue.locator("li")).toHaveCount(1);
	expect(errors).toEqual([]);
});

test("unfunded purchases hold lower priorities and the page remains accessible on mobile", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/#transactions");
	await page.getByRole("button", { name: "Open navigation" }).click();
	await page
		.getByRole("link", { name: "Planned purchases", exact: true })
		.click();
	await expect(
		page.getByRole("dialog", { name: "Workspace navigation" }),
	).not.toBeVisible();
	await expect(page).toHaveURL(/#purchases$/);
	await addPurchase(page, "Unfunded item", "1000000000");
	await addPurchase(page, "Small item", "25");
	await expect(page.getByText("Not funded within this timeframe")).toHaveCount(
		2,
	);
	await expect(
		page.getByRole("list", { name: "Purchase dates" }).locator("time"),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Move Small item up" }).focus();
	await page.keyboard.press("Enter");
	await expect(
		page
			.getByRole("list", { name: "Purchase priorities" })
			.getByRole("listitem")
			.first(),
	).toContainText("Small item");
	await expect(
		page.getByRole("list", { name: "Purchase dates" }).locator("time"),
	).toHaveCount(1);
	const audit = await new AxeBuilder({ page })
		.include('[aria-label="Planned purchases"]')
		.analyze();
	expect(audit.violations).toEqual([]);
	for (const width of [320, 390, 768, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
			`planned purchases at ${width}px`,
		).toBeLessThanOrEqual(width);
	}
});

test("read-only plans do not allow purchase writes", async ({ page }) => {
	await resetFixture({ readOnly: true });
	await openPurchases(page);
	await expect(
		page.getByRole("button", { name: "Add purchase" }),
	).toBeDisabled();
});
